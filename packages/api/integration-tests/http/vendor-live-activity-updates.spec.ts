import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { fulfilmentService } from "../../src/lib/order-fulfilment"
import { remindAcceptDeadlines } from "../../src/lib/order-acceptance"
import { resumeShop, setWeeklyHours } from "../../src/lib/shop-hours"
import { keepShopActivitiesCurrent } from "../../src/lib/vendor-live-activity"
import { LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityTokenModuleService } from "../../src/modules/live-activity-token"
import { seedDemoWorld } from "../../src/scripts/seed"
import { apnsToken, fakeApns } from "../helpers/apns"
import { buyerCheckout, eventually, GADGETS, GROCERY, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"
import { ALWAYS_OPEN, closedBetween, keepShopsOpen } from "../helpers/shop-hours"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
const paystack = fakePaystack(61000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(62000 + (process.pid % 1000))
const expo = fakeExpoPush(63000 + (process.pid % 1000))
const apns = fakeApns(64000 + (process.pid % 500), 64500 + (process.pid % 500))
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl
Object.assign(process.env, apns.env)

const KEY_HEADER = "x-live-activity-key"
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const LAGOS = "Africa/Lagos"

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    type Headers = { headers: Record<string, string> }
    const owner = () => buyer.owner(GROCERY)
    const withKey = (as: Headers, key: string): Headers => ({ headers: { ...as.headers, [KEY_HEADER]: key } })
    const report = (key: string, body: Record<string, string>) =>
      api.post("/vendor/live-activity-tokens", { environment: "sandbox", ...body }, { headers: { [KEY_HEADER]: key } })

    /** A phone with the switch on for the grocery shop. */
    const optedIn = async (as: Headers) => {
      const { data } = await api.post("/vendor/live-activity-devices", { environment: "sandbox" }, as)
      const key = data.device.key as string
      const pushToStart = apnsToken()
      await report(key, { kind: "push_to_start", token: pushToStart })
      await api.post("/vendor/live-activity-devices/current/shop", { on: true }, withKey(as, key))
      return { key, pushToStart }
    }
    const reportActivity = async (key: string, shop: Shop = GROCERY) => {
      const token = apnsToken()
      await report(key, { kind: "activity", activity_id: `activity-${token}`, token, seller_id: await buyer.sellerId(shop) })
      return token
    }
    const placeOrder = async () => {
      const { cartId } = await buyer.paidCheckout()
      return buyer.shopOrderId(GROCERY, cartId)
    }
    const startsOn = (token: string, count = 1) => eventually(async () => apns.sentTo(token), (sent) => sent.length >= count)
    const accept = async (orderId: string) => api.post(`/vendor/orders/${orderId}/accept`, {}, await owner())
    const tiles = async () => (await api.get("/vendor/order-stages", await owner())).data.counts
    const placedAt = async (orderId: string) => {
      const [row] = await fulfilmentService(getContainer()).listOrderFulfilments({ order_id: orderId }, { select: ["placed_at"] })
      return new Date(row.placed_at).getTime()
    }
    const propsOf = (push: { aps: Record<string, any> }) => JSON.parse(push.aps["content-state"].props)
    /** The minute job, at a time the test sets. */
    const tick = (at: number) => keepShopActivitiesCurrent(getContainer(), new Date(at))
    const groceryHours = async (weekly: typeof ALWAYS_OPEN) => setWeeklyHours(getContainer(), await buyer.sellerId(GROCERY), weekly)

    /** An activity running on a phone, with its update token, already told everything so far. */
    const running = async () => {
      const member = await owner()
      const { key, pushToStart } = await optedIn(member)
      const orderId = await placeOrder()
      await startsOn(pushToStart)
      const update = await reportActivity(key)
      return { member, key, pushToStart, update, orderId }
    }

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), apns.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), apns.stop()]))
    beforeEach(async () => {
      expo.reset()
      apns.reset()
      await buyer.load()
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
      const store = getContainer().resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)
      await store.deleteLiveActivityDevices((await store.listLiveActivityDevices({})).map(({ id }) => id))
      await Promise.all([GROCERY, GADGETS].map(async (shop) => resumeShop(getContainer(), await buyer.sellerId(shop))))
      // Each test starts with no orders waiting: earlier tests' would hold the nearest deadline.
      const fulfilments = fulfilmentService(getContainer())
      const waiting = await fulfilments.listOrderFulfilments({ state: "new" }, { select: ["id"], take: null })
      if (waiting.length) await fulfilments.updateOrderFulfilments(waiting.map(({ id }) => ({ id, state: "rejected" })))
    })

    describe("stage counts", () => {
      it("sends several changes as one quiet update with the latest counts, matching the stage tiles", async () => {
        const member = await owner()
        const { key, pushToStart } = await optedIn(member)
        const first = await placeOrder()
        await startsOn(pushToStart)
        const second = await placeOrder()
        const third = await placeOrder()
        const update = await reportActivity(key)
        await tick(Date.now() + MINUTE)
        expect(apns.sentTo(update)).toHaveLength(1)

        await accept(first)
        await accept(second)
        await accept(third)
        expect(apns.sentTo(update)).toHaveLength(1)

        await tick(Date.now() + 2 * MINUTE)

        const [, batched, ...more] = apns.sentTo(update)
        expect(more).toEqual([])
        expect(batched.priority).toBe("5")
        expect(batched.aps.event).toBe("update")
        expect(batched.aps.alert).toBeUndefined()
        expect(batched.aps["content-state"].name).toBe("ShopOrdersActivity")
        expect(propsOf(batched).counts).toEqual(await tiles())
        expect(propsOf(batched).counts.new).toBe(0)

        await tick(Date.now() + 3 * MINUTE)
        expect(apns.sentTo(update)).toHaveLength(2)
      })

      it("holds a change until 30 seconds after the last push", async () => {
        const { update, orderId } = await running()
        await placeOrder()
        await startsOn(update)
        const pushed = Date.now()
        const sent = apns.sentTo(update).length

        await accept(orderId)
        await tick(pushed + 10 * 1000)
        expect(apns.sentTo(update)).toHaveLength(sent)

        await tick(pushed + 31 * 1000)
        expect(apns.sentTo(update)).toHaveLength(sent + 1)
      })

      it("sends nothing when nothing changed since the start", async () => {
        const { update } = await running()
        await tick(Date.now() + MINUTE)
        expect(apns.sentTo(update)).toEqual([])
      })

      it("brings a phone up to date once it reports its token late", async () => {
        const member = await owner()
        const { key, pushToStart } = await optedIn(member)
        const orderId = await placeOrder()
        await startsOn(pushToStart)
        await accept(orderId)
        await tick(Date.now() + MINUTE)

        const update = await reportActivity(key)
        await tick(Date.now() + 2 * MINUTE)

        expect(apns.sentTo(update).map((p) => p.priority)).toEqual(["5"])
        expect(propsOf(apns.sentTo(update)[0]).counts).toEqual(await tiles())
      })
    })

    describe("alerting updates", () => {
      it("a new order updates at once, at priority 10 with an alert, and doesn't start another", async () => {
        const { update, pushToStart } = await running()

        await placeOrder()

        const [push, ...more] = await startsOn(update)
        expect(more).toEqual([])
        expect(push.priority).toBe("10")
        expect(push.aps.event).toBe("update")
        expect(push.aps.alert).toEqual({ title: GROCERY.name, body: "New order. 2 waiting to accept." })
        expect(propsOf(push).counts).toEqual(await tiles())
        expect(apns.sentTo(pushToStart)).toHaveLength(1)

        await tick(Date.now() + MINUTE)
        expect(apns.sentTo(update)).toHaveLength(1)
      })

      it("an order entering its last two hours updates at once with an alert, once", async () => {
        const { update, orderId } = await running()
        const placed = await placedAt(orderId)

        await remindAcceptDeadlines(getContainer(), new Date(placed + 21 * HOUR))
        expect(apns.sentTo(update)).toEqual([])

        const twoHoursLeft = new Date(placed + 22 * HOUR + MINUTE)
        await remindAcceptDeadlines(getContainer(), twoHoursLeft)

        const [push, ...more] = await startsOn(update)
        expect(more).toEqual([])
        expect(push.priority).toBe("10")
        expect(push.aps.event).toBe("update")
        expect(push.aps.alert).toEqual({ title: GROCERY.name, body: "An order has under 2 hours to accept." })
        expect(propsOf(push).urgent).toBe(true)
        expect(propsOf(push).deadline).toBe(new Date(placed + 24 * HOUR).toISOString())

        await remindAcceptDeadlines(getContainer(), new Date(twoHoursLeft.getTime() + MINUTE))
        await tick(twoHoursLeft.getTime() + MINUTE)
        expect(apns.sentTo(update)).toHaveLength(1)
      })

      it("turns urgent quietly if the job gets there before the reminder, so the phone is never behind", async () => {
        const { update, orderId } = await running()
        await tick((await placedAt(orderId)) + 22 * HOUR + MINUTE)
        const [push] = apns.sentTo(update)
        expect(propsOf(push).urgent).toBe(true)
        expect(push.priority).toBe("5")
      })
    })

    describe("the nearest deadline", () => {
      it("is the nearest unaccepted order's, and clears when none is left", async () => {
        const member = await owner()
        const { key, pushToStart } = await optedIn(member)
        const nearest = await placeOrder()
        await startsOn(pushToStart)
        expect(propsOf(apns.sentTo(pushToStart)[0]).deadline).toBe(new Date((await placedAt(nearest)) + 24 * HOUR).toISOString())

        const later = await placeOrder()
        const update = await reportActivity(key)
        await tick(Date.now() + MINUTE)
        expect(propsOf(apns.sentTo(update)[0]).deadline).toBe(new Date((await placedAt(nearest)) + 24 * HOUR).toISOString())

        await accept(nearest)
        await tick(Date.now() + 2 * MINUTE)
        expect(propsOf(apns.sentTo(update)[1]).deadline).toBe(new Date((await placedAt(later)) + 24 * HOUR).toISOString())

        await accept(later)
        await tick(Date.now() + 3 * MINUTE)
        expect(propsOf(apns.sentTo(update)[2])).toMatchObject({ deadline: null, urgent: false })
      })

      it("counts open hours as the time chip does: two closed hours make it 26 hours away", async () => {
        const now = Date.now() - (Date.now() % MINUTE)
        await groceryHours(closedBetween(now + HOUR, now + 3 * HOUR, LAGOS))
        const { pushToStart } = await optedIn(await owner())

        const orderId = await placeOrder()

        const [start] = await startsOn(pushToStart)
        expect(propsOf(start).deadline).toBe(new Date((await placedAt(orderId)) + 26 * HOUR).toISOString())
      })

      it("is resent when the shop's hours change", async () => {
        const { update, orderId } = await running()
        const now = Date.now() - (Date.now() % MINUTE)

        await groceryHours(closedBetween(now + HOUR, now + 3 * HOUR, LAGOS))
        await tick(now + 2 * MINUTE)

        expect(propsOf(apns.sentTo(update)[0]).deadline).toBe(new Date((await placedAt(orderId)) + 26 * HOUR).toISOString())
      })
    })

    describe("opening and closing", () => {
      it("sends the deadline as it stands when the shop closes, and again when it opens", async () => {
        const member = await owner()
        const { key, pushToStart } = await optedIn(member)
        const orderId = await placeOrder()
        await startsOn(pushToStart)
        const update = await reportActivity(key)
        const now = Date.now() - (Date.now() % MINUTE)
        await groceryHours(closedBetween(now + HOUR, now + 3 * HOUR, LAGOS))
        const deadline = new Date((await placedAt(orderId)) + 26 * HOUR).toISOString()

        await tick(now + HOUR + MINUTE)
        const last = apns.sentTo(update).at(-1)!
        expect(last.aps.event).toBe("end")
        expect(propsOf(last).deadline).toBe(deadline)

        await tick(now + 2 * HOUR)
        expect(apns.sentTo(pushToStart)).toHaveLength(1)

        await tick(now + 3 * HOUR + MINUTE)
        const [, reopened, ...more] = apns.sentTo(pushToStart)
        expect(more).toEqual([])
        expect(reopened.priority).toBe("10")
        expect(reopened.aps.event).toBe("start")
        expect(propsOf(reopened).deadline).toBe(deadline)
        expect(propsOf(reopened).counts).toEqual(await tiles())

        await tick(now + 3 * HOUR + 2 * MINUTE)
        expect(apns.sentTo(pushToStart)).toHaveLength(2)
      })

      it("shows an order placed while closed when the shop opens", async () => {
        const now = Date.now() - (Date.now() % MINUTE)
        await groceryHours(closedBetween(now - MINUTE, now + 2 * HOUR, LAGOS))
        const { pushToStart } = await optedIn(await owner())
        const device = pushToken()
        await api.post("/vendor/push-tokens", { token: device }, await owner())

        await placeOrder()
        await eventually(async () => expo.sentTo(device), (sent) => sent.length >= 1)
        await tick(now + MINUTE)
        expect(apns.sentTo(pushToStart)).toEqual([])

        await tick(now + 2 * HOUR + MINUTE)
        const [start, ...more] = apns.sentTo(pushToStart)
        expect(more).toEqual([])
        expect(propsOf(start).counts.new).toBe(1)
        expect(propsOf(start).deadline).not.toBeNull()
      })

      it("starts nothing at opening with no order waiting", async () => {
        const { orderId, pushToStart } = await running()
        await accept(orderId)
        const now = Date.now() - (Date.now() % MINUTE)
        await groceryHours(closedBetween(now + HOUR, now + 3 * HOUR, LAGOS))

        await tick(now + HOUR + MINUTE)
        await tick(now + 3 * HOUR + MINUTE)

        expect(apns.sentTo(pushToStart)).toHaveLength(1)
      })

      it("doesn't start just because the switch was turned on while orders wait, when the shop didn't open", async () => {
        const device = pushToken()
        await api.post("/vendor/push-tokens", { token: device }, await owner())
        await placeOrder()
        await eventually(async () => expo.sentTo(device), (sent) => sent.length >= 1)
        const { pushToStart } = await optedIn(await owner())

        await tick(Date.now() + MINUTE)

        expect(apns.sentTo(pushToStart)).toEqual([])
      })

      it("resuming a paused shop starts it again at once, with orders still waiting", async () => {
        const { member, update, pushToStart } = await running()

        await api.post("/vendor/shop-hours/pause", {}, member)
        const [end] = await startsOn(update)
        expect(end.aps.event).toBe("end")
        expect(propsOf(end).deadline).not.toBeNull()

        await api.post("/vendor/shop-hours/resume", {}, member)

        await startsOn(pushToStart, 2)
        await tick(Date.now() + MINUTE)
        expect(apns.sentTo(pushToStart)).toHaveLength(2)
      })
    })

    describe("phones that shouldn't be updated", () => {
      it("ends the activity once the switch is turned off", async () => {
        const { member, key, update, orderId } = await running()
        await api.post("/vendor/live-activity-devices/current/shop", { on: false }, withKey(member, key))
        await accept(orderId)

        await tick(Date.now() + MINUTE)
        await tick(Date.now() + 2 * MINUTE)

        expect(apns.sentTo(update).map((p) => p.aps.event)).toEqual(["end"])
      })

      it("ends the activity on a phone that changed hands to someone outside the shop", async () => {
        const { key, update, orderId } = await running()
        await api.post("/vendor/live-activity-devices", { environment: "sandbox" }, withKey(await buyer.owner(GADGETS), key))
        await accept(orderId)

        await tick(Date.now() + MINUTE)

        expect(apns.sentTo(update).map((p) => p.aps.event)).toEqual(["end"])
      })

      it("stops at a token Apple rejects, and doesn't bring the activity back until a new order", async () => {
        const { update, pushToStart, orderId } = await running()
        apns.unregister(update)
        const second = await placeOrder()
        await accept(second)

        await tick(Date.now() + MINUTE)
        await accept(orderId)
        await tick(Date.now() + 2 * MINUTE)
        expect(apns.sentTo(pushToStart)).toHaveLength(1)

        await placeOrder()
        await startsOn(pushToStart, 2)
      })

      it("doesn't alert a phone whose switch was turned off, in the moments before it ends", async () => {
        const { member, key, update } = await running()
        await api.post("/vendor/live-activity-devices/current/shop", { on: false }, withKey(member, key))
        const device = pushToken()
        await api.post("/vendor/push-tokens", { token: device }, member)

        await placeOrder()
        await eventually(async () => expo.sentTo(device), (sent) => sent.length >= 1)

        // Its ending may already have gone: the minute job ends it with the switch off, and may fire during this test.
        expect(apns.sentTo(update).filter((p) => p.aps.event !== "end")).toEqual([])
      })

      it("updates only the shop that changed", async () => {
        const { update } = await running()
        const gadgets = await optedIn(await buyer.owner(GADGETS))
        const { cartId } = await buyer.paidCheckout()
        await startsOn(gadgets.pushToStart)
        const gadgetsUpdate = await reportActivity(gadgets.key, GADGETS)
        await tick(Date.now() + MINUTE)
        const before = [apns.sentTo(update).length, apns.sentTo(gadgetsUpdate).length]

        await api.post(`/vendor/orders/${await buyer.shopOrderId(GADGETS, cartId)}/accept`, {}, await buyer.owner(GADGETS))
        await tick(Date.now() + 2 * MINUTE)

        expect(apns.sentTo(update)).toHaveLength(before[0])
        expect(apns.sentTo(gadgetsUpdate)).toHaveLength(before[1] + 1)
      })
    })
  },
})
