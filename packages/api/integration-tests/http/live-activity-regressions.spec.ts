import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { seedDemoWorld } from "../../src/scripts/seed"
import { retryBuyerActivityEndings } from "../../src/lib/buyer-live-activity"
import { LIVE_ACTIVITY_TOKEN_MODULE } from "../../src/modules/live-activity-token"
import { PUSH_TOKEN_MODULE } from "../../src/modules/push-token"
import { ADDRESS, buyerCheckout, eventually, GROCERY, RETURN_URL, RICE } from "../helpers/checkout"
import { apnsToken, fakeApns } from "../helpers/apns"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"
import { keepShopsOpen } from "../helpers/shop-hours"

jest.setTimeout(5 * 60 * 1000)

// Regressions found reviewing PR 152 (#133): Live Activities and Android Live Updates when a push fails, races or lands late.

const clerk = fakeClerk()
const paystack = fakePaystack(41000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(42000 + (process.pid % 1000))
const expo = fakeExpoPush(43000 + (process.pid % 1000))
const apns = fakeApns(44000 + (process.pid % 999), 45000 + (process.pid % 500))
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl
Object.assign(process.env, apns.env)

const KEY_HEADER = "x-live-activity-key"
const HOUR = 60 * 60 * 1000

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const { ada, offerId, owner } = buyer

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), apns.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
      await keepShopsOpen(getContainer(), [GROCERY])
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), apns.stop()]))
    beforeEach(async () => {
      expo.reset()
      apns.reset()
      await buyer.load()
    })

    const withKey = (key: string, as = buyer.headers()) => ({ headers: { ...as, [KEY_HEADER]: key } })
    const post = async (path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await owner(GROCERY))
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const tokens = () => getContainer().resolve<any>(LIVE_ACTIVITY_TOKEN_MODULE)
    const shipbubbleSays = (...args: Parameters<typeof shipbubble.webhook>) => {
      const { body, headers } = shipbubble.webhook(...args)
      return api.post("/hooks/shipbubble", body, { headers })
    }

    const paidOrder = async () => {
      const { data } = await api.post("/store/carts", { region_id: buyer.regionId() }, ada())
      const cartId = data.cart.id as string
      await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, RICE.title), quantity: 1 }, ada())
      await api.post(`/store/carts/${cartId}/checkout`, { shipping_address: ADDRESS }, ada())
      const { data: started } = await api.post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())
      const reference = started.payment.reference as string
      paystack.pay(reference)
      await buyer.postWebhook(paystack.chargeSuccess(reference))
      await buyer.orderGroupOf(cartId)
      await buyer.capturedWithin(cartId)
      const orderId = await buyer.shopOrderId(GROCERY, cartId)
      const vendorState = async () => (await api.get(`/vendor/orders/${orderId}`, await owner(GROCERY))).data.order.fulfilment?.state
      await eventually(vendorState, (state) => state === "new")
      return { orderId }
    }
    const pack = async (orderId: string) => {
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await owner(GROCERY))).data
      for (const line of pick_list.lines) await post(`${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      await post(`${orderId}/pack`)
    }

    // ---------- Android ----------
    const android = async () => {
      const device = pushToken()
      await api.post("/store/push-tokens", { token: device, platform: "android" }, ada())
      return device
    }
    const updatesOf = (device: string, orderId: string) => expo.sentTo(device).filter((m: any) => m.data?.live_update && m.data.order_id === orderId) as any[]
    const lastIs = (device: string, orderId: string, label: string) =>
      eventually(async () => updatesOf(device, orderId), (sent) => sent.at(-1)?.data.content.step.label === label)

    it("stamps each message with the phone's sign-in, and never hands that on to the next person", async () => {
      const device = pushToken()
      await api.post("/store/push-tokens", { token: device, platform: "android", session: "ada-session-1" }, ada())
      const { orderId } = await paidOrder()
      await post(`${orderId}/accept`)
      const [shown] = await lastIs(device, orderId, "Being prepared")
      expect(shown.data.session).toBe("ada-session-1")

      // Ben signs in on the phone with a build that doesn't say: Ada's id mustn't follow the phone.
      await api.post("/store/push-tokens", { token: device, platform: "android" }, { headers: buyer.as("ben@oja.test").headers })
      const rows = await getContainer().resolve<any>(PUSH_TOKEN_MODULE).listPushTokens({ token: device })
      expect(rows[0].session).toBeNull()
    })

    it("retries an Android ending Expo refused, as iOS does", async () => {
      const device = await android()
      const { orderId } = await paidOrder()
      await post(`${orderId}/accept`)
      await lastIs(device, orderId, "Being prepared")

      expo.fail(device)
      await post(`${orderId}/cancel`, { reason: "items_unavailable" })
      await eventually(async () => updatesOf(device, orderId), (sent) => sent.some((m) => m.data.action === "end"))
      expo.recover(device)

      // What the minute jobs would do over the next while.
      for (let i = 0; i < 3; i++) {
        await retryBuyerActivityEndings(getContainer())
        await sleep(1000)
      }
      expect(updatesOf(device, orderId).filter((m) => m.data.action === "end").length).toBeGreaterThanOrEqual(2)
      const rows = await tokens().listBuyerLiveUpdates({ order_id: orderId })
      expect(rows.every((row: { ended_at: unknown }) => row.ended_at)).toBe(true)
    })

    it("never leaves an older step on the phone with the newest revision", async () => {
      const device = await android()
      const { orderId } = await paidOrder()
      await post(`${orderId}/accept`)
      await lastIs(device, orderId, "Being prepared")

      // Slow down the packed event's handler between reading the order and sending.
      const pushTokens = getContainer().resolve<any>(PUSH_TOKEN_MODULE)
      const original = pushTokens.listPushTokens.bind(pushTokens)
      let armed = true
      pushTokens.listPushTokens = async (filters: any, config?: any) => {
        if (armed && filters?.platform === "android" && filters?.actor_type === "customer") {
          armed = false
          await sleep(4000)
        }
        return original(filters, config)
      }
      try {
        await pack(orderId)
        await post(`${orderId}/book-label`)
        await sleep(7000)
      } finally {
        pushTokens.listPushTokens = original
      }

      const state = (await api.get(`/vendor/orders/${orderId}`, await owner(GROCERY))).data.order.fulfilment.state
      const byRevision = [...updatesOf(device, orderId)].sort((a, b) => a.data.revision - b.data.revision)
      expect(byRevision.at(-1).data.content.step.label).toBe("Courier booked")
    })

    // ---------- iOS ----------
    const sentTo = (token: string, count = 1) => eventually(async () => apns.sentTo(token), (sent) => sent.length >= count)
    const iPhone = async (pushToStart = true) => {
      const device = pushToken()
      await api.post("/store/push-tokens", { token: device }, ada())
      const { data } = await api.post("/store/live-activity-devices", { environment: "sandbox", push_token: device }, ada())
      const key = data.device.key as string
      const start = apnsToken()
      if (pushToStart) await api.post("/store/live-activity-tokens", { kind: "push_to_start", token: start, environment: "sandbox" }, withKey(key))
      return { key, device, pushToStart: start }
    }
    const reportToken = (key: string, orderId: string, token = apnsToken(), activityId = `activity-${token}`) =>
      api
        .post("/store/live-activity-tokens", { kind: "activity", activity_id: activityId, token, environment: "sandbox", order_id: orderId }, withKey(key))
        .then(() => token)

    it("sends nothing of Ada's order to a phone that has moved to Ben when its token arrives", async () => {
      const phone = await iPhone(false) // below iOS 17.2: starts its own activity
      const { orderId } = await paidOrder()
      await post(`${orderId}/accept`)
      const activityId = `activity-${apnsToken()}`
      await api.post("/store/live-activities", { order_id: orderId, activity_id: activityId, environment: "sandbox" }, withKey(phone.key))

      // Ada's sign-out never reached the server; Ben signs in on the phone with its key.
      await api.post("/store/live-activity-devices", { environment: "sandbox" }, { headers: { ...buyer.as("ben@oja.test").headers, [KEY_HEADER]: phone.key } })
      const token = apnsToken()
      await api.post(
        "/store/live-activity-tokens",
        { kind: "activity", activity_id: activityId, token, environment: "sandbox", order_id: orderId },
        withKey(phone.key, buyer.as("ben@oja.test").headers)
      )
      await sleep(3000)

      expect(apns.sentTo(token)).toEqual([])
    })

    it("keeps following the old activity when a refused restart's cleanup throws", async () => {
      const phone = await iPhone()
      const { orderId } = await paidOrder()
      await post(`${orderId}/accept`)
      await sentTo(phone.pushToStart)
      const token = await reportToken(phone.key, orderId)
      await sentTo(token)
      await pack(orderId)
      await sentTo(token, 2)
      apns.reset()
      const running = await tokens().listLiveActivities({ subject_id: orderId, ended_at: null })
      await tokens().updateLiveActivities(running.map(({ id }: { id: string }) => ({ id, started_at: new Date(Date.now() - 7 * HOUR) })))

      apns.fail(phone.pushToStart)
      const store = tokens()
      const original = store.deleteLiveActivities.bind(store)
      store.deleteLiveActivities = async () => {
        throw new Error("database hiccup")
      }
      try {
        await post(`${orderId}/book-label`)
        await eventually(async () => apns.attemptsTo(phone.pushToStart), (n) => n >= 1)
        await sleep(2000)
      } finally {
        store.deleteLiveActivities = original
      }
      apns.recover(phone.pushToStart)

      // The old activity is the running one again.
      const [current] = await tokens().listLiveActivities({ subject_id: orderId, ended_at: null })
      expect(current.token).toBe(token)
      const waybill = (await api.get(`/vendor/orders/${orderId}`, await owner(GROCERY))).data.order.fulfilment.shipment.waybill
      await shipbubbleSays(waybill, "confirmed")
      await sleep(3000)
      expect(apns.sentTo(token).length).toBeGreaterThanOrEqual(1)
    })
  },
})
