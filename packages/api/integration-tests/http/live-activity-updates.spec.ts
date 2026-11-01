import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { formatMoney } from "@oja/domain"
import { seedDemoWorld } from "../../src/scripts/seed"
import { SEED_PERISHABLE_CATEGORIES, SEED_PRODUCTS } from "../../src/scripts/seed-data"
import { endBuyerActivities } from "../../src/lib/buyer-live-activity"
import { expirePickupHolds } from "../../src/lib/pickup-hold-expiry"
import { LIVE_ACTIVITY_TOKEN_MODULE } from "../../src/modules/live-activity-token"
import { ADDRESS, buyerCheckout, eventually, GROCERY, RETURN_URL, RICE } from "../helpers/checkout"
import { apnsToken, fakeApns } from "../helpers/apns"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"
import { keepShopsOpen } from "../helpers/shop-hours"

jest.setTimeout(5 * 60 * 1000)

// A buyer's activity following a shop order to its end (#144): what reaches Apple, and which
// Expo pushes it stands in for.

const clerk = fakeClerk()
const paystack = fakePaystack(61000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(62000 + (process.pid % 1000))
const expo = fakeExpoPush(63000 + (process.pid % 1000))
const apns = fakeApns(64000 + (process.pid % 999), 65000 + (process.pid % 500))
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
const DAY = 24 * HOUR
const TOMATOES = SEED_PRODUCTS.find((p) => p.category === SEED_PERISHABLE_CATEGORIES[0])!

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const { ada, offerId, owner, sellerId } = buyer

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

    const withKey = (key: string) => ({ headers: { ...buyer.headers(), [KEY_HEADER]: key } })
    const post = async (path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await owner(GROCERY))
    const settle = () => new Promise((resolve) => setTimeout(resolve, 1500))
    const props = (push: { aps: any }) => JSON.parse(push.aps["content-state"].props)
    const shipbubbleSays = (...args: Parameters<typeof shipbubble.webhook>) => {
      const { body, headers } = shipbubble.webhook(...args)
      return api.post("/hooks/shipbubble", body, { headers })
    }

    /** A phone that gets Expo pushes and that Apple can start activities on. */
    const iPhone = async (as = ada()) => {
      const device = pushToken()
      await api.post("/store/push-tokens", { token: device }, as)
      const { data } = await api.post("/store/live-activity-devices", { environment: "sandbox", push_token: device }, as)
      const key = data.device.key as string
      const pushToStart = apnsToken()
      await api.post("/store/live-activity-tokens", { kind: "push_to_start", token: pushToStart, environment: "sandbox" }, withKey(key))
      return { key, device, pushToStart }
    }
    /** iOS hands the app a running activity's token, and the app says which order its url names. */
    const reportToken = (key: string, orderId: string | undefined, token = apnsToken(), activityId = `activity-${token}`) =>
      api
        .post("/store/live-activity-tokens", { kind: "activity", activity_id: activityId, token, environment: "sandbox", ...(orderId ? { order_id: orderId } : {}) }, withKey(key))
        .then(() => token)
    const sentTo = (token: string, count = 1) => eventually(async () => apns.sentTo(token), (sent) => sent.length >= count)
    const pushedTitles = (device: string) => expo.sentTo(device).map((m: any) => m.title as string)

    const activities = () => getContainer().resolve<any>(LIVE_ACTIVITY_TOKEN_MODULE)
    /** As if the order's activity started this long ago. */
    const startedAgo = async (orderId: string, ms: number) => {
      const running = await activities().listLiveActivities({ subject_id: orderId, ended_at: null })
      await activities().updateLiveActivities(running.map(({ id }: { id: string }) => ({ id, started_at: new Date(Date.now() - ms) })))
    }

    /** Ada's order of rice from the grocery, paid for and waiting for the shop. */
    const paidOrder = async ({ pickup = false, fresh = 0 } = {}) => {
      const { data } = await api.post("/store/carts", { region_id: buyer.regionId() }, ada())
      const cartId = data.cart.id as string
      await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, RICE.title), quantity: 1 }, ada())
      if (fresh) await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, TOMATOES.title), quantity: fresh }, ada())
      await api.post(`/store/carts/${cartId}/checkout`, { shipping_address: ADDRESS, ...(pickup ? { pickup: [await sellerId(GROCERY)] } : {}) }, ada())
      const { data: started } = await api.post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())
      const reference = started.payment.reference as string
      paystack.pay(reference)
      await buyer.postWebhook(paystack.chargeSuccess(reference))
      const groupId = await buyer.orderGroupOf(cartId)
      await buyer.capturedWithin(cartId)
      const orderId = await buyer.shopOrderId(GROCERY, cartId)
      const vendorState = async () => (await api.get(`/vendor/orders/${orderId}`, await owner(GROCERY))).data.order.fulfilment?.state
      await eventually(vendorState, (state) => state === "new")
      return { orderId, groupId, number: await buyer.orderNumberOf(orderId) }
    }
    /** The order accepted, with its activity started on the phone and its token reported. */
    const following = async (phone: { key: string; pushToStart: string }, options = {}) => {
      const order = await paidOrder(options)
      await post(`${order.orderId}/accept`)
      await sentTo(phone.pushToStart)
      const token = await reportToken(phone.key, order.orderId)
      await sentTo(token)
      apns.reset()
      return { ...order, token }
    }
    const pack = async (orderId: string) => {
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await owner(GROCERY))).data
      for (const line of pick_list.lines) await post(`${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      await post(`${orderId}/pack`)
    }
    const packAndBook = async (orderId: string) => {
      await pack(orderId)
      const { data } = await post(`${orderId}/book-label`)
      return data.fulfilment.shipment.waybill as string
    }

    describe("the first update", () => {
      it("brings the activity up to where the order is once its token arrives: accepting moved it on to picking", async () => {
        const { key, pushToStart } = await iPhone()
        const { orderId } = await paidOrder()

        await post(`${orderId}/accept`)
        const [start] = await sentTo(pushToStart)
        expect(props(start).step.label).toBe("Accepted")

        const token = await reportToken(key, orderId)
        const [update] = await sentTo(token)
        expect(update.aps.event).toBe("update")
        expect(update.priority).toBe("5")
        expect(update.aps.alert).toBeUndefined()
        expect(props(update).step.label).toBe("Being prepared")
      })

      it("isn't repeated when the phone reports the same token again on a later launch", async () => {
        const { key, pushToStart } = await iPhone()
        const { orderId } = await paidOrder()
        await post(`${orderId}/accept`)
        await sentTo(pushToStart)
        const token = await reportToken(key, orderId)
        await sentTo(token)

        await reportToken(key, orderId, token)
        await settle()

        expect(apns.sentTo(token)).toHaveLength(1)
      })

      it("won't tie a token to someone else's order", async () => {
        const bens = await iPhone(buyer.as("ben@oja.test"))
        const { orderId } = await paidOrder()
        await post(`${orderId}/accept`)

        const token = await reportToken(bens.key, orderId)
        await settle()

        expect(apns.sentTo(token)).toEqual([])
      })

      it("ends at once an activity whose order finished before its token arrived, as when the Allow prompt waited", async () => {
        const { key, pushToStart } = await iPhone()
        const { orderId } = await paidOrder()
        await post(`${orderId}/accept`)
        await sentTo(pushToStart)
        await post(`${orderId}/cancel`, { reason: "items_unavailable" })
        await settle()

        const token = await reportToken(key, orderId)

        const [end] = await sentTo(token)
        expect(end.aps.event).toBe("end")
        expect(props(end).outcome.kind).toBe("cancelled")
      })

      it("ends a second activity on the phone for an order it already follows", async () => {
        const phone = await iPhone()
        const { orderId, token } = await following(phone)

        const spare = await reportToken(phone.key, orderId)

        const [end] = await sentTo(spare)
        expect(end.aps.event).toBe("end")
        expect(apns.sentTo(token)).toEqual([])
      })
    })

    describe("a delivery moving on", () => {
      it("updates at each state, alerting only where a push goes, and ends delivered with a short dismissal", async () => {
        const phone = await iPhone()
        const { orderId, number, token } = await following(phone)

        const waybill = await packAndBook(orderId)
        await sentTo(token, 2)
        await shipbubbleSays(waybill, "confirmed")
        await sentTo(token, 3)
        await post(`${orderId}/hand-over`)
        await shipbubbleSays(waybill, "picked_up")
        await sentTo(token, 4)
        await shipbubbleSays(waybill, "in_transit")
        await sentTo(token, 5)
        await shipbubbleSays(waybill, "completed")
        const pushes = await sentTo(token, 6)

        expect(pushes.map((p) => [props(p).step.label, p.aps.event, p.priority, p.aps.alert?.title ?? null])).toEqual([
          ["Packed", "update", "5", null],
          ["Courier booked", "update", "10", `Courier booked for order ${number}`],
          ["Courier booked", "update", "5", null],
          ["Picked up by the courier", "update", "10", `Order ${number} picked up`],
          ["On its way", "update", "5", null],
          ["Delivered", "end", "10", null],
        ])
        for (const push of pushes) {
          expect(push.topic).toBe(`${apns.env.APNS_BUYER_BUNDLE_ID}.push-type.liveactivity`)
          expect(push.aps["content-state"].name).toBe("BuyerOrderActivity")
        }
        const end = pushes[5]
        expect(props(end).outcome).toEqual({ kind: "delivered" })
        const dismissal = end.aps["dismissal-date"] * 1000
        expect(dismissal).toBeGreaterThan(Date.now())
        expect(dismissal).toBeLessThan(Date.now() + HOUR)
        // Every push still goes, for a buyer with activities off and a phone whose update got nowhere.
        expect(pushedTitles(phone.device)).toEqual(expect.arrayContaining([`Courier booked for order ${number}`, `Order ${number} picked up`, `Order ${number} delivered`]))
      })

      it("sends nothing more once it has ended", async () => {
        const phone = await iPhone()
        const { orderId, token } = await following(phone)
        await post(`${orderId}/cancel`, { reason: "items_unavailable" })
        await sentTo(token)

        await settle()

        expect(apns.sentTo(token)).toHaveLength(1)
      })

      it("doesn't reach a phone that has moved to someone else", async () => {
        const phone = await iPhone()
        const { orderId, token } = await following(phone)
        // A sign-out that never reached the server: Ben signs in on the phone with its key.
        await api.post("/store/live-activity-devices", { environment: "sandbox" }, { headers: { ...buyer.as("ben@oja.test").headers, [KEY_HEADER]: phone.key } })

        await pack(orderId)
        await settle()

        expect(apns.sentTo(token)).toEqual([])
      })
    })

    describe("an ending", () => {
      it("says a cancelled order's who, why and refund", async () => {
        const phone = await iPhone()
        const { orderId, groupId, token } = await following(phone)
        const { data } = await api.get(`/store/order-history/${groupId}`, ada())
        const paid = data.order_group.orders.find((o: any) => o.id === orderId).paid_total as number

        await post(`${orderId}/cancel`, { reason: "items_unavailable" })

        const [end] = await sentTo(token)
        expect(end.aps.event).toBe("end")
        expect(end.priority).toBe("10")
        expect(end.aps["dismissal-date"]).toBeGreaterThan(Date.now() / 1000)
        expect(props(end).step.label).toBe("Cancelled by the shop")
        expect(props(end).outcome).toEqual({ kind: "cancelled", by: "seller", reason: "Items unavailable", refund: formatMoney(paid, "ngn") })
      })
    })

    describe("a pickup", () => {
      const collectable = async (phone: { key: string; pushToStart: string }, options = {}) => {
        await api.post("/vendor/collection-point", { follows_pickup_address: true, instructions: "Ask at the till." }, await owner(GROCERY))
        const order = await following(phone, { pickup: true, ...options })
        await pack(order.orderId)
        return order
      }
      const codeOf = async (groupId: string, orderId: string) => {
        const { data } = await api.get(`/store/order-history/${groupId}`, ada())
        return data.order_group.orders.find((o: any) => o.id === orderId).pickup.code as string
      }

      it("shows the code once ready, alerting, and ends once collected", async () => {
        const phone = await iPhone()
        const { orderId, groupId, number, token } = await collectable(phone)

        const [ready] = await sentTo(token)
        const code = await codeOf(groupId, orderId)
        expect(ready.aps.event).toBe("update")
        expect(ready.priority).toBe("10")
        expect(ready.aps.alert.title).toBe(`Order ${number} is ready for pickup`)
        expect(props(ready).code).toBe(`${code.slice(0, 3)} ${code.slice(3)}`)
        expect(props(ready).step.label).toBe("Ready for pickup")

        await post(`${orderId}/collect`, { code, collected_by: "Tunde Bakare" })

        const [, end] = await sentTo(token, 2)
        expect(end.aps.event).toBe("end")
        expect(props(end).outcome).toEqual({ kind: "collected" })
        expect(props(end).code).toBeNull()
      })

      it("ends not collected with the refund and the fresh items that aren't refunded", async () => {
        const phone = await iPhone()
        const { orderId, groupId, token } = await collectable(phone, { fresh: 1 })
        await sentTo(token)
        const { data } = await api.get(`/store/order-history/${groupId}`, ada())
        const order = data.order_group.orders.find((o: any) => o.id === orderId)
        const readyAt = order.fulfilment.timeline.find((s: any) => s.label === "Ready for pickup").at as string

        await expirePickupHolds(getContainer(), new Date(Date.parse(readyAt) + 30 * DAY))

        const [, end] = await sentTo(token, 2)
        expect(end.aps.event).toBe("end")
        expect(props(end).outcome).toEqual({ kind: "not_collected", refund: formatMoney(RICE.price, "ngn"), kept: `1 × ${TOMATOES.title}` })
      })

      it("starts a fresh activity with the code if the order is ready past iOS's 8 hours, in place of the push", async () => {
        await api.post("/vendor/collection-point", { follows_pickup_address: true, instructions: "Ask at the till." }, await owner(GROCERY))
        const phone = await iPhone()
        const { orderId, groupId, number } = await following(phone, { pickup: true })
        apns.reset()
        expo.reset()
        await startedAgo(orderId, 7 * HOUR)

        await pack(orderId)

        const [start] = await sentTo(phone.pushToStart)
        const code = await codeOf(groupId, orderId)
        expect(start.aps.event).toBe("start")
        expect(props(start).code).toBe(`${code.slice(0, 3)} ${code.slice(3)}`)
        await settle()
        expect(pushedTitles(phone.device)).not.toContain(`Order ${number} is ready for pickup`)
      })
    })

    describe("past iOS's 8 hours", () => {
      it("starts a fresh activity for a pushed milestone, whose alert replaces the push, and ends the old one", async () => {
        const phone = await iPhone()
        const { orderId, groupId, number, token } = await following(phone)
        await pack(orderId)
        await sentTo(token)
        apns.reset()
        expo.reset()
        await startedAgo(orderId, 7 * HOUR)

        await post(`${orderId}/book-label`)

        const [start] = await sentTo(phone.pushToStart)
        expect(start.aps.event).toBe("start")
        expect(start.priority).toBe("10")
        expect(start.aps.alert.title).toBe(`Courier booked for order ${number}`)
        expect(start.aps.attributes.url).toBe(`oja://order/${groupId}?shop_order=${orderId}`)
        expect(props(start).step.label).toBe("Courier booked")
        const [end] = await sentTo(token)
        expect(end.aps.event).toBe("end")
        await settle()
        expect(pushedTitles(phone.device)).not.toContain(`Courier booked for order ${number}`)

        // The fresh activity's own token takes over.
        const fresh = await reportToken(phone.key, orderId)
        await sentTo(fresh)
        const waybill = (await api.get(`/vendor/orders/${orderId}`, await owner(GROCERY))).data.order.fulfilment.shipment.waybill
        await shipbubbleSays(waybill, "confirmed")
        await sentTo(fresh, 2)
        expect(apns.sentTo(token)).toHaveLength(1)
      })

      it("keeps the push for a phone that has never reported a token", async () => {
        const { pushToStart, device } = await iPhone()
        const { orderId, number } = await paidOrder()
        await post(`${orderId}/accept`)
        await sentTo(pushToStart)
        await pack(orderId)
        await startedAgo(orderId, 8 * HOUR)
        expo.reset()

        await post(`${orderId}/book-label`)

        await sentTo(pushToStart, 2)
        await eventually(async () => pushedTitles(device), (titles) => titles.includes(`Courier booked for order ${number}`))
      })

      it("is an ordinary update for a step with no push", async () => {
        const phone = await iPhone()
        const { orderId, token } = await following(phone)
        await startedAgo(orderId, 9 * HOUR)

        await pack(orderId)

        const [update] = await sentTo(token)
        expect(update.aps.event).toBe("update")
        expect(apns.sentTo(phone.pushToStart).filter((p) => p.aps.event === "start")).toEqual([])
      })

      it("keeps the push and updates the old activity if Apple refuses the fresh start", async () => {
        const phone = await iPhone()
        const { orderId, number, token } = await following(phone)
        await pack(orderId)
        await sentTo(token)
        apns.reset()
        expo.reset()
        await startedAgo(orderId, 7 * HOUR)
        apns.unregister(phone.pushToStart)

        await post(`${orderId}/book-label`)

        const [update] = await sentTo(token)
        expect(update.aps.event).toBe("update")
        await eventually(async () => pushedTitles(phone.device), (titles) => titles.includes(`Courier booked for order ${number}`))
      })
    })

    describe("a token Apple rejects", () => {
      it.each([["410", "unregister"], ["BadDeviceToken", "rejectAsBad"]] as const)("is forgotten on %s", async (_, how) => {
        const phone = await iPhone()
        const { orderId, token } = await following(phone)
        apns[how](token)

        await pack(orderId)
        await eventually(() => activities().listLiveActivities({ token }), (held: unknown[]) => held.length === 0)
      })
    })

    describe("ending a buyer's activities", () => {
      it("ends each running one at once, showing where its order is", async () => {
        const phone = await iPhone()
        const { token } = await following(phone)
        const [device] = await activities().listLiveActivityDevices({ push_to_start_token: phone.pushToStart })

        await endBuyerActivities(getContainer(), device.actor_id)

        const [end] = await sentTo(token)
        expect(end.aps.event).toBe("end")
        expect(end.aps["dismissal-date"]).toBeLessThanOrEqual(Date.now() / 1000 + 1)
        expect(props(end).step.label).toBe("Being prepared")
      })
    })

    describe("signing out", () => {
      it("forgets the phone's activity tokens, so nothing more reaches them", async () => {
        const phone = await iPhone()
        const { orderId, token } = await following(phone)

        await api.delete("/store/live-activity-devices/current", { headers: { ...ada().headers, [KEY_HEADER]: phone.key } })
        await pack(orderId)
        await settle()

        expect(apns.sentTo(token)).toEqual([])
        expect(await activities().listLiveActivities({ token })).toEqual([])
      })
    })
  },
})
