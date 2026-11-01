import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { seedDemoWorld } from "../../src/scripts/seed"
import { buyerCheckout, eventually, GADGETS, GROCERY } from "../helpers/checkout"
import { apnsToken, fakeApns } from "../helpers/apns"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"
import { keepShopsOpen } from "../helpers/shop-hours"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
const paystack = fakePaystack(56000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(57000 + (process.pid % 1000))
const expo = fakeExpoPush(58000 + (process.pid % 1000))
const apns = fakeApns(59000 + (process.pid % 1000), 60000 + (process.pid % 1000))
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl
Object.assign(process.env, apns.env)

const KEY_HEADER = "x-live-activity-key"
const BEN = "ben@oja.test"

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), apns.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), apns.stop()]))
    beforeEach(async () => {
      expo.reset()
      apns.reset()
      await buyer.load()
    })

    /** What a request sent with only the device's key looks like: a launch before the session is restored. */
    const withKey = (key: string) => ({ headers: { ...buyer.headers(), [KEY_HEADER]: key } })
    const signedInWithKey = (key: string, as = buyer.ada()) => ({ headers: { ...as.headers, [KEY_HEADER]: key } })
    /** The phone signs in: it is given its key. */
    const registerDevice = async (as = buyer.ada(), body: Record<string, unknown> = {}) => {
      const { data } = await api.post("/store/live-activity-devices", { environment: "sandbox", ...body }, as)
      return data.device.key as string
    }
    const reportPushToStart = (key: string, token = apnsToken(), environment = "sandbox") =>
      api.post("/store/live-activity-tokens", { kind: "push_to_start", token, environment }, withKey(key)).then(() => token)
    const reportActivityToken = (key: string, token = apnsToken()) =>
      api
        .post("/store/live-activity-tokens", { kind: "activity", activity_id: `activity-${token}`, token, environment: "sandbox" }, withKey(key))
        .then(() => token)
    /** A phone that gets Expo pushes and can be started by Apple. */
    const iPhone = async (as = buyer.ada(), environment = "sandbox") => {
      const device = pushToken()
      await api.post("/store/push-tokens", { token: device }, as)
      const key = await registerDevice(as, { push_token: device, environment })
      return { key, device, pushToStart: await reportPushToStart(key, undefined, environment) }
    }
    const android = async () => {
      const device = pushToken()
      await api.post("/store/push-tokens", { token: device }, buyer.ada())
      return device
    }
    const accept = async (shop: typeof GROCERY, orderId: string) => api.post(`/vendor/orders/${orderId}/accept`, {}, await buyer.owner(shop))
    const startsOn = (token: string, count = 1) => eventually(async () => apns.sentTo(token), (sent) => sent.length >= count)
    const settle = () => new Promise((resolve) => setTimeout(resolve, 1500))
    const paidOrders = async () => {
      const { cartId } = await buyer.paidCheckout()
      return {
        grocery: await buyer.shopOrderId(GROCERY, cartId),
        gadgets: await buyer.shopOrderId(GADGETS, cartId),
        groupId: await buyer.orderGroupOf(cartId),
      }
    }
    const acceptedPushes = (device: string) => expo.sentTo(device).filter((m: any) => /accepted$/.test(m.title))

    describe("registering a phone's tokens", () => {
      it("won't give a key without a signed-in buyer", async () => {
        expect(await status(api.post("/store/live-activity-devices", { environment: "sandbox" }, { headers: buyer.headers() }))).toBe(401)
      })

      it("takes a token with the phone's key alone, so a launch before auth is restored can report it", async () => {
        const key = await registerDevice()
        expect(await status(reportPushToStart(key))).toBe(200)
      })

      it("refuses a token with no key or a made-up one", async () => {
        const body = { kind: "push_to_start", token: apnsToken(), environment: "sandbox" }
        expect(await status(api.post("/store/live-activity-tokens", body, { headers: buyer.headers() }))).toBe(401)
        expect(await status(api.post("/store/live-activity-tokens", body, withKey("not-a-key")))).toBe(401)
      })

      it("refuses what isn't an APNs token or environment", async () => {
        const key = await registerDevice()
        const post = (body: unknown) => status(api.post("/store/live-activity-tokens", body, withKey(key)))
        expect(await post({ kind: "push_to_start", token: "ExponentPushToken[abc]", environment: "sandbox" })).toBe(400)
        expect(await post({ kind: "push_to_start", token: apnsToken(), environment: "staging" })).toBe(400)
      })

      it("accepts the same tokens again, as iOS sends them on later launches", async () => {
        const key = await registerDevice()
        const token = await reportPushToStart(key)
        expect(await status(reportPushToStart(key, token))).toBe(200)
        const activity = await reportActivityToken(key)
        expect(await status(reportActivityToken(key, activity))).toBe(200)
      })

      it("keeps the phone's key when the buyer registers it again", async () => {
        const key = await registerDevice()
        expect(await registerDevice(signedInWithKey(key))).toBe(key)
      })
    })

    describe("when a shop accepts", () => {
      it("starts the activity on Ada's iPhone, which shows the accepted step and opens the order", async () => {
        const { pushToStart } = await iPhone()
        const { grocery, groupId } = await paidOrders()
        const number = await buyer.orderNumberOf(grocery)

        await accept(GROCERY, grocery)

        const [push] = await startsOn(pushToStart)
        expect(push).toMatchObject({
          environment: "sandbox",
          topic: `${apns.env.APNS_BUYER_BUNDLE_ID}.push-type.liveactivity`,
          priority: "10",
        })
        expect(push.aps).toMatchObject({
          event: "start",
          "input-push-token": 1,
          attributes: { url: `oja://order/${groupId}?shop_order=${grocery}` },
          alert: { title: `Order ${number} accepted`, body: `${GROCERY.name} is preparing your order.` },
        })
        expect(push.aps["content-state"].name).toBe("BuyerOrderActivity")
        expect(JSON.parse(push.aps["content-state"].props)).toMatchObject({
          number,
          shop: GROCERY.name,
          method: "delivery",
          step: { label: "Accepted", index: 2, total: 8, next: "Being prepared" },
          code: null,
          outcome: null,
        })
      })

      it("starts one activity per accepted shop order of a two-shop checkout", async () => {
        const { pushToStart } = await iPhone()
        const { grocery, gadgets } = await paidOrders()

        await accept(GROCERY, grocery)
        await startsOn(pushToStart, 1)
        await settle()
        expect(apns.sentTo(pushToStart)).toHaveLength(1)

        await accept(GADGETS, gadgets)
        const pushes = await startsOn(pushToStart, 2)
        expect(pushes.map((p) => JSON.parse(p.aps["content-state"].props).shop).sort()).toEqual([GADGETS.name, GROCERY.name].sort())
      })

      it("starts it on each of her iPhones, on the host of each one's build", async () => {
        const phone = await iPhone(buyer.ada(), "sandbox")
        const storeBuild = await iPhone(buyer.ada(), "production")
        const { grocery } = await paidOrders()

        await accept(GROCERY, grocery)

        expect((await startsOn(phone.pushToStart))[0].environment).toBe("sandbox")
        expect((await startsOn(storeBuild.pushToStart))[0].environment).toBe("production")
      })

      it("doesn't start another for a repeat of the same event", async () => {
        const { pushToStart } = await iPhone()
        const { grocery } = await paidOrders()
        await accept(GROCERY, grocery)
        await startsOn(pushToStart)

        await getContainer().resolve("event_bus").emit({ name: "order_fulfilment.state_changed", data: { id: grocery, state: "accepted" } })
        await settle()

        expect(apns.sentTo(pushToStart)).toHaveLength(1)
      })

      it("sends nothing to Apple for someone else's order", async () => {
        const ben = await iPhone(buyer.as(BEN))
        const { grocery } = await paidOrders()

        await accept(GROCERY, grocery)
        await settle()

        expect(apns.sentTo(ben.pushToStart)).toHaveLength(0)
      })
    })

    describe("the accepted push", () => {
      const allowedLiveActivities = async (phone: { key: string }) => reportActivityToken(phone.key)

      it("still goes to Android, where there's no activity", async () => {
        const phone = await android()
        const { grocery } = await paidOrders()

        await accept(GROCERY, grocery)

        const pushes = await eventually(async () => acceptedPushes(phone), (sent) => sent.length >= 1)
        expect(pushes[0].title).toMatch(/accepted$/)
      })

      it("still goes to an iPhone that has never reported an update token: it may have refused Live Activities", async () => {
        const phone = await iPhone()
        const { grocery } = await paidOrders()

        await accept(GROCERY, grocery)

        await startsOn(phone.pushToStart)
        await eventually(async () => acceptedPushes(phone.device), (sent) => sent.length >= 1)
      })

      it("doesn't go to an iPhone that reported one from an earlier activity: the start's alert replaces it", async () => {
        const phone = await iPhone()
        await allowedLiveActivities(phone)
        const other = await android()
        const { grocery } = await paidOrders()

        await accept(GROCERY, grocery)

        await startsOn(phone.pushToStart)
        await eventually(async () => acceptedPushes(other), (sent) => sent.length >= 1)
        await settle()
        expect(acceptedPushes(phone.device)).toHaveLength(0)
      })

      it("goes after all when Apple refuses the start, whose token is then forgotten", async () => {
        const phone = await iPhone()
        await allowedLiveActivities(phone)
        apns.unregister(phone.pushToStart)
        const { grocery, gadgets } = await paidOrders()

        await accept(GROCERY, grocery)
        await eventually(async () => acceptedPushes(phone.device), (sent) => sent.length >= 1)

        apns.reset()
        await accept(GADGETS, gadgets)
        await eventually(async () => acceptedPushes(phone.device), (sent) => sent.length >= 2)
        expect(apns.sentTo(phone.pushToStart)).toHaveLength(0)
      })

      it("goes after all when Apple can't be reached, and the next try can still start it", async () => {
        const phone = await iPhone()
        await allowedLiveActivities(phone)
        const sender = getContainer().resolve<any>("liveActivityPush")
        const send = sender.send
        sender.send = async () => ({ status: "failed", reason: "down" })
        const { grocery } = await paidOrders()
        try {
          await accept(GROCERY, grocery)
          await eventually(async () => acceptedPushes(phone.device), (sent) => sent.length >= 1)
        } finally {
          sender.send = send
        }

        await getContainer().resolve("event_bus").emit({ name: "order_fulfilment.state_changed", data: { id: grocery, state: "accepted" } })

        await startsOn(phone.pushToStart)
      })
    })

    describe("signing out", () => {
      it("stops the activity starting there, and the key stops working", async () => {
        const phone = await iPhone()
        await api.delete("/store/live-activity-devices/current", signedInWithKey(phone.key))
        const { grocery } = await paidOrders()

        await accept(GROCERY, grocery)
        await eventually(async () => acceptedPushes(phone.device), (sent) => sent.length >= 1)

        expect(apns.sentTo(phone.pushToStart)).toHaveLength(0)
        // A token post that was on its way, or arrives hours late, can't bring the phone back.
        expect(await status(reportPushToStart(phone.key))).toBe(401)
      })

      it("is only for the phone's own buyer", async () => {
        const phone = await iPhone()
        const ben = buyer.as(BEN)

        expect(await status(api.delete("/store/live-activity-devices/current", { headers: buyer.headers() }))).toBe(401)
        expect(await status(api.delete("/store/live-activity-devices/current", withKey(phone.key)))).toBe(401)
        await api.delete("/store/live-activity-devices/current", signedInWithKey(phone.key, ben))
        expect(await status(reportPushToStart(phone.key))).toBe(200)
      })

      it("moves the phone to whoever signs in next, and its token with it", async () => {
        const phone = await iPhone()
        // Ada's sign-out never reached the server; Ben signs in on the same phone.
        const bensKey = await registerDevice(buyer.as(BEN))
        await reportPushToStart(bensKey, phone.pushToStart)
        const { grocery } = await paidOrders()

        await accept(GROCERY, grocery)
        await settle()

        expect(apns.sentTo(phone.pushToStart)).toHaveLength(0)
      })

      it("moves a phone that registers again under the same key", async () => {
        const phone = await iPhone()
        await registerDevice(signedInWithKey(phone.key, buyer.as(BEN)))
        const { grocery } = await paidOrders()

        await accept(GROCERY, grocery)
        await settle()

        expect(apns.sentTo(phone.pushToStart)).toHaveLength(0)
      })
    })

    describe("older iOS", () => {
      const owed = async (key: string, as = buyer.ada()) => (await api.get("/store/live-activities/owed", signedInWithKey(key, as))).data.activities
      const started = (key: string, order_id: string, activity_id = `activity-${order_id}`) =>
        api.post("/store/live-activities", { order_id, activity_id, environment: "sandbox" }, withKey(key))

      it("lists the accepted shop orders with no activity on this phone, with what to start them with", async () => {
        const key = await registerDevice()
        const { grocery, gadgets, groupId } = await paidOrders()
        expect(await owed(key)).toEqual([])

        await accept(GROCERY, grocery)

        const list = await owed(key)
        expect(list).toHaveLength(1)
        expect(list[0]).toMatchObject({
          order_id: grocery,
          url: `oja://order/${groupId}?shop_order=${grocery}`,
          // Accepting moves the order straight on to picking, so the phone starts it where the order is now.
          content: { shop: GROCERY.name, step: { label: "Being prepared" } },
        })
        await started(key, grocery)
        expect(await owed(key)).toEqual([])

        await accept(GADGETS, gadgets)
        expect((await owed(key)).map((a: any) => a.order_id)).toEqual([gadgets])
      })

      it("owes nothing to a phone the server starts itself", async () => {
        const { key } = await iPhone()
        const { grocery } = await paidOrders()
        await accept(GROCERY, grocery)

        expect(await owed(key)).toEqual([])
      })

      it("won't record an activity for someone else's order", async () => {
        const bensKey = await registerDevice(buyer.as(BEN))
        const { grocery } = await paidOrders()
        await accept(GROCERY, grocery)

        expect(await status(started(bensKey, grocery))).toBe(404)
      })
    })
  },
})
