import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { formatMoney } from "@oja/domain"
import { seedDemoWorld } from "../../src/scripts/seed"
import { SEED_PERISHABLE_CATEGORIES, SEED_PRODUCTS } from "../../src/scripts/seed-data"
import { expirePickupHolds } from "../../src/lib/pickup-hold-expiry"
import { ADDRESS, buyerCheckout, eventually, GROCERY, RETURN_URL, RICE } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"
import { keepShopsOpen } from "../helpers/shop-hours"

jest.setTimeout(5 * 60 * 1000)

// A buyer's shop order as an Android Live Update (#148): the data-only messages that reach Expo.

const clerk = fakeClerk()
const paystack = fakePaystack(51000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(52000 + (process.pid % 1000))
const expo = fakeExpoPush(53000 + (process.pid % 1000))
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl

const DAY = 24 * 60 * 60 * 1000
const TOMATOES = SEED_PRODUCTS.find((p) => p.category === SEED_PERISHABLE_CATEGORIES[0])!

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const { ada, offerId, owner, sellerId } = buyer

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
      await keepShopsOpen(getContainer(), [GROCERY])
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop()]))
    beforeEach(async () => {
      expo.reset()
      await buyer.load()
    })

    const post = async (path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await owner(GROCERY))
    const settle = () => new Promise((resolve) => setTimeout(resolve, 1500))
    const shipbubbleSays = (...args: Parameters<typeof shipbubble.webhook>) => {
      const { body, headers } = shipbubble.webhook(...args)
      return api.post("/hooks/shipbubble", body, { headers })
    }

    const phone = async (platform?: "android" | "ios") => {
      const device = pushToken()
      await api.post("/store/push-tokens", { token: device, ...(platform ? { platform } : {}) }, ada())
      return device
    }
    const android = () => phone("android")

    const updates = (device: string) => expo.sentTo(device).filter((m: any) => m.data?.live_update) as any[]
    const updatesOf = (device: string, orderId: string) => updates(device).filter((m) => m.data.order_id === orderId)
    const pushedTitles = (device: string) => expo.sentTo(device).flatMap((m: any) => (m.title ? [m.title as string] : []))
    const lastIs = (device: string, orderId: string, label: string) =>
      eventually(
        async () => updatesOf(device, orderId),
        (sent) => sent.at(-1)?.data.content.step.label === label
      )

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
    const pack = async (orderId: string) => {
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await owner(GROCERY))).data
      for (const line of pick_list.lines) await post(`${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      await post(`${orderId}/pack`)
    }

    describe("a delivery moving on", () => {
      it("sends a silent, data-only message at each step and ends delivered, and every normal push still goes", async () => {
        const device = await android()
        const { orderId, groupId, number } = await paidOrder()
        expect(updates(device)).toHaveLength(0)

        await post(`${orderId}/accept`)
        await lastIs(device, orderId, "Being prepared")
        await pack(orderId)
        await lastIs(device, orderId, "Packed")
        const { data } = await post(`${orderId}/book-label`)
        const waybill = data.fulfilment.shipment.waybill as string
        await lastIs(device, orderId, "Courier booked")
        await shipbubbleSays(waybill, "confirmed")
        await post(`${orderId}/hand-over`)
        await shipbubbleSays(waybill, "picked_up")
        await lastIs(device, orderId, "Picked up by the courier")
        await shipbubbleSays(waybill, "in_transit")
        await lastIs(device, orderId, "On its way")
        await shipbubbleSays(waybill, "completed")
        const sent = await lastIs(device, orderId, "Delivered")

        for (const message of sent) {
          // Nothing Android could show by itself: the phone's task decides.
          expect(message.title).toBeUndefined()
          expect(message.body).toBeUndefined()
          expect(message.sound).toBeUndefined()
          expect(message.priority).toBe("high")
          expect(message.ttl).toBe(12 * 60 * 60)
          expect(message.data.url).toBe(`oja://order/${groupId}?shop_order=${orderId}`)
        }
        const labels = sent.map((m) => m.data.content.step.label)
        for (const label of ["Being prepared", "Packed", "Courier booked", "Picked up by the courier", "On its way"]) expect(labels).toContain(label)
        expect(sent.slice(0, -1).every((m) => m.data.action === "show")).toBe(true)
        expect(sent.at(-1).data.action).toBe("end")
        expect(sent.at(-1).data.content.outcome).toEqual({ kind: "delivered" })
        // In the order they were sent, so the phone can ignore one that arrives late.
        const revisions = sent.map((m) => m.data.revision)
        expect(revisions).toEqual([...revisions].sort((a, b) => a - b))

        const told = [`Order ${number} accepted`, `Courier booked for order ${number}`, `Order ${number} picked up`, `Order ${number} delivered`]
        await eventually(async () => pushedTitles(device), (titles) => told.every((title) => titles.includes(title)))
      })

      it("reaches only a phone that says it's Android: an iPhone has its activity, and an older build can't draw it", async () => {
        const [iPhone, older, device] = [await phone("ios"), await phone(), await android()]
        const { orderId } = await paidOrder()

        await post(`${orderId}/accept`)

        await lastIs(device, orderId, "Being prepared")
        await settle()
        expect(updates(iPhone)).toHaveLength(0)
        expect(updates(older)).toHaveLength(0)
      })

      it("learns the platform when a phone already registered says it later", async () => {
        const device = await phone()
        await api.post("/store/push-tokens", { token: device, platform: "android" }, ada())
        const { orderId } = await paidOrder()

        await post(`${orderId}/accept`)

        await lastIs(device, orderId, "Being prepared")
      })

      it("ends a cancelled order with who, why and the refund, as iOS does", async () => {
        const device = await android()
        const { orderId } = await paidOrder()
        await post(`${orderId}/accept`)
        await lastIs(device, orderId, "Being prepared")

        await post(`${orderId}/cancel`, { reason: "items_unavailable" })

        const sent = await eventually(async () => updatesOf(device, orderId), (all) => all.at(-1)?.data.action === "end")
        expect(sent.at(-1).data.content.outcome).toMatchObject({ kind: "cancelled", by: "seller", reason: "Items unavailable" })
        await settle()
        expect(updatesOf(device, orderId).filter((m) => m.data.action === "show" && m.data.content.outcome)).toHaveLength(0)
      })

      it("sends nothing for an order rejected before it was accepted", async () => {
        const device = await android()
        const { orderId } = await paidOrder()

        await post(`${orderId}/reject`, { reason: "Out of stock" })

        await eventually(async () => pushedTitles(device), (titles) => titles.length >= 1)
        await settle()
        expect(updatesOf(device, orderId)).toHaveLength(0)
      })
    })

    describe("a pickup", () => {
      const collectable = async (options = {}) => {
        await api.post("/vendor/collection-point", { follows_pickup_address: true, instructions: "Ask at the till." }, await owner(GROCERY))
        const order = await paidOrder({ pickup: true, ...options })
        await post(`${order.orderId}/accept`)
        await pack(order.orderId)
        return order
      }
      const orderOf = async (groupId: string, orderId: string) => {
        const { data } = await api.get(`/store/order-history/${groupId}`, ada())
        return data.order_group.orders.find((o: any) => o.id === orderId)
      }

      it("shows the code once ready and ends once collected", async () => {
        const device = await android()
        const { orderId, groupId } = await collectable()

        const ready = await lastIs(device, orderId, "Ready for pickup")
        const { code } = (await orderOf(groupId, orderId)).pickup
        expect(ready.at(-1).data.content.code).toBe(`${code.slice(0, 3)} ${code.slice(3)}`)

        await post(`${orderId}/collect`, { code, collected_by: "Tunde Bakare" })

        const sent = await eventually(async () => updatesOf(device, orderId), (all) => all.at(-1)?.data.action === "end")
        expect(sent.at(-1).data.content.outcome).toEqual({ kind: "collected" })
        expect(sent.at(-1).data.content.code).toBeNull()
      })

      it("ends not collected with the refund and the fresh items that aren't refunded", async () => {
        const device = await android()
        const { orderId, groupId } = await collectable({ fresh: 1 })
        await lastIs(device, orderId, "Ready for pickup")
        const order = await orderOf(groupId, orderId)
        const readyAt = order.fulfilment.timeline.find((s: any) => s.label === "Ready for pickup").at as string

        await expirePickupHolds(getContainer(), new Date(Date.parse(readyAt) + 30 * DAY))

        const sent = await eventually(async () => updatesOf(device, orderId), (all) => all.at(-1)?.data.action === "end")
        expect(sent.at(-1).data.content.outcome).toEqual({ kind: "not_collected", refund: formatMoney(RICE.price, "ngn"), kept: `1 × ${TOMATOES.title}` })
      })
    })

    describe("the Orders on Lock Screen switch", () => {
      const turn = (orders_on_lock_screen: boolean) => api.post("/store/customers/me/notification-preferences", { orders_on_lock_screen }, ada())
      afterEach(() => turn(true))

      it("sends none with it off, while the normal pushes go on", async () => {
        const device = await android()
        await turn(false)
        const { orderId, number } = await paidOrder()

        await post(`${orderId}/accept`)

        await eventually(async () => pushedTitles(device), (titles) => titles.includes(`Order ${number} accepted`))
        await settle()
        expect(updates(device)).toHaveLength(0)
      })

      it("takes away what's showing when it's turned off, and sends nothing more, not even the ending", async () => {
        const device = await android()
        const { orderId, number } = await paidOrder()
        await post(`${orderId}/accept`)
        await lastIs(device, orderId, "Being prepared")

        await turn(false)

        const sent = await eventually(async () => updatesOf(device, orderId), (all) => all.at(-1)?.data.action === "remove")
        const count = sent.length
        await pack(orderId)
        await post(`${orderId}/cancel`, { reason: "items_unavailable" })
        await eventually(async () => pushedTitles(device), (titles) => titles.some((title) => title.includes(number) && /cancel/i.test(title)))
        await settle()
        expect(updatesOf(device, orderId)).toHaveLength(count)
      })
    })

    it("stops when the phone signs out, with its push token", async () => {
      const device = await android()
      const { orderId } = await paidOrder()
      await post(`${orderId}/accept`)
      await lastIs(device, orderId, "Being prepared")
      await api.delete(`/store/push-tokens/${encodeURIComponent(device)}`, ada())
      const count = updates(device).length

      await pack(orderId)

      await settle()
      expect(updates(device)).toHaveLength(count)
    })
  },
})
