import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { fulfilmentService } from "../../src/lib/order-fulfilment"
import { payOutDeliveredOrders } from "../../src/lib/pay-out-orders"
import { expireUncollectedOrders } from "../../src/lib/pickup-hold"
import { setWeeklyHours } from "../../src/lib/shop-hours"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PERISHABLE_CATEGORIES, SEED_PRODUCTS } from "../../src/scripts/seed-data"
import { ADDRESS, buyerCheckout, eventually, GADGETS, GROCERY, LANTERN, RETURN_URL, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"
import { ALWAYS_OPEN } from "../helpers/shop-hours"

jest.setTimeout(5 * 60 * 1000)

// The pickup hold (#32): a pickup order nobody collects expires to Not collected.

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(43000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(44000 + (process.pid % 1000))
const expo = fakeExpoPush(45000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl

const TOMATOES = SEED_PRODUCTS.find((p) => p.category === SEED_PERISHABLE_CATEGORIES[0])!
const AT_THE_SHOP = { follows_pickup_address: true, instructions: "Ask at the till for online orders." }
const DAY = 24 * 60 * 60 * 1000
const MINUTE = 60 * 1000

/** In kobo, as Paystack moves it. */
const kobo = (naira: number) => Math.round(naira * 100)
/** The local midnight (Africa/Lagos, UTC+1) starting the day `days` after the instant's Lagos date. */
const lagosMidnightAfter = (at: string, days: number) => {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(at))
  return new Date(Date.parse(`${date}T00:00:00+01:00`) + days * DAY).toISOString()
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const { ada, offerId, owner, sellerId } = buyer
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      expo.reset()
      await buyer.load()
      // Open round the clock, so the hold's open days are calendar days whenever the test runs.
      await setWeeklyHours(getContainer(), await sellerId(GROCERY), ALWAYS_OPEN)
      await api.post("/vendor/collection-point", AT_THE_SHOP, await owner(GROCERY))
    })

    const post = async (shop: Shop, path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await owner(shop))
    const vendorOrder = async (orderId: string) => (await api.get(`/vendor/orders/${orderId}`, await owner(GROCERY))).data.order

    /**
     * Ada's paid order from the grocery, to collect in store, of `lines` (title and quantity), with
     * a lantern from the gadget hub delivered; Ready for pickup. Returns its order, order group and
     * Paystack reference, and when it became ready.
     */
    const readyOrder = async (lines: [string, number][]) => {
      const { data } = await api.post("/store/carts", { region_id: buyer.regionId() }, ada())
      const cartId = data.cart.id as string
      await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GADGETS, LANTERN.title), quantity: 1 }, ada())
      for (const [title, quantity] of lines) {
        await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, title), quantity }, ada())
      }
      await api.post(`/store/carts/${cartId}/checkout`, { shipping_address: ADDRESS, pickup: [await sellerId(GROCERY)] }, ada())
      const { data: started } = await api.post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())
      const reference = started.payment.reference as string
      paystack.pay(reference)
      await buyer.postWebhook(paystack.chargeSuccess(reference))
      const groupId = await buyer.orderGroupOf(cartId)
      await buyer.capturedWithin(cartId)
      const orderId = await buyer.shopOrderId(GROCERY, cartId)
      await eventually(() => vendorOrder(orderId), (o) => o.fulfilment?.state === "new")
      await post(GROCERY, `${orderId}/accept`)
      await post(GROCERY, `${orderId}/start-picking`)
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await owner(GROCERY))).data
      for (const line of pick_list.lines) await post(GROCERY, `${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      const { data: packed } = await post(GROCERY, `${orderId}/pack`)
      const readyAt = packed.fulfilment.timeline.find((s: any) => s.label === "Ready for pickup").at as string
      return { orderId, groupId, reference, readyAt }
    }
    const adasOrder = async (groupId: string, orderId: string) => {
      const { data } = await api.get(`/store/order-history/${groupId}`, ada())
      return data.order_group.orders.find((o: any) => o.id === orderId)
    }
    /** How many of the grocery's units of a product are reserved for orders, and how many it stocks. */
    const stockOf = async (title: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [offer] } = await query.graph({
        entity: "offer",
        fields: ["inventory_items.location_levels.reserved_quantity", "inventory_items.location_levels.stocked_quantity"],
        filters: { id: await offerId(GROCERY, title) },
      })
      const [level] = offer.inventory_items.flatMap((i: any) => i.location_levels)
      return { reserved: Number(level.reserved_quantity), stocked: Number(level.stocked_quantity) }
    }
    const refundsOf = (reference: string) => paystack.refundsOf(reference).map((r) => r.amount)
    const orderPayout = async (orderId: string) => (await api.get(`/vendor/orders/${orderId}/payout`, await owner(GROCERY))).data.payout
    const transferFor = (orderId: string) => paystack.transfers().find((t) => t.reference === `payout_${orderId}`.toLowerCase())

    describe("an order nobody collects", () => {
      it("stays Ready for pickup through its 5 open days, then is Not collected: refunded, its stock returned, the code dead", async () => {
        const before = await stockOf(RICE.title)
        const { orderId, groupId, reference, readyAt } = await readyOrder([[RICE.title, 2]])
        expect(await stockOf(RICE.title)).toEqual({ ...before, reserved: before.reserved + 2 })
        const { code } = (await adasOrder(groupId, orderId)).pickup

        await expireUncollectedOrders(getContainer(), new Date(Date.parse(readyAt) + 5 * DAY))
        expect((await vendorOrder(orderId)).fulfilment.state).toBe("ready_for_pickup")

        await expireUncollectedOrders(getContainer(), new Date(Date.parse(readyAt) + 6 * DAY + MINUTE))

        const order = await adasOrder(groupId, orderId)
        expect(order.fulfilment.state).toBe("not_collected")
        expect(order.pickup.code).toBeNull()
        expect(refundsOf(reference)).toEqual([kobo(2 * RICE.price)])
        expect(await stockOf(RICE.title)).toEqual(before)
        // Final: no handover, and off the counter's list.
        expect(await status(post(GROCERY, `${orderId}/collect`, { code, collected_by: "Tunde Bakare" }))).toBe(400)
        expect((await api.get("/vendor/ready-for-pickup", await owner(GROCERY))).data.order_ids).not.toContain(orderId)
        // Nothing is left to pay the shop.
        expect((await orderPayout(orderId)).state).toBe("not_due")
        await payOutDeliveredOrders(getContainer())
        expect(transferFor(orderId)).toBeUndefined()
        const [row] = await fulfilmentService(getContainer()).listOrderFulfilments({ order_id: orderId })
        expect(row.payout_eligible_at).toBeNull()
      })

      it("with fresh items expires at the next open day's closing: the rest is refunded and restocked, the fresh items paid to the shop less 10%", async () => {
        const [rice, tomatoes] = [await stockOf(RICE.title), await stockOf(TOMATOES.title)]
        const { orderId, groupId, reference, readyAt } = await readyOrder([
          [RICE.title, 2],
          [TOMATOES.title, 1],
        ])

        await expireUncollectedOrders(getContainer(), new Date(Date.parse(readyAt) + DAY))
        expect((await vendorOrder(orderId)).fulfilment.state).toBe("ready_for_pickup")
        await expireUncollectedOrders(getContainer(), new Date(Date.parse(readyAt) + 2 * DAY + MINUTE))

        expect((await adasOrder(groupId, orderId)).fulfilment.state).toBe("not_collected")
        // Only the rice comes back, to the buyer and to the shelf; the tomatoes stay sold.
        expect(refundsOf(reference)).toEqual([kobo(2 * RICE.price)])
        expect(await stockOf(RICE.title)).toEqual(rice)
        expect(await stockOf(TOMATOES.title)).toEqual({ ...tomatoes, reserved: tomatoes.reserved + 1 })

        // Paid out once the rice's refund has settled, for the tomatoes alone.
        expect(await orderPayout(orderId)).toMatchObject({ paid: 2 * RICE.price + TOMATOES.price, refunded: 2 * RICE.price, delivery: 0 })
        for (const refund of paystack.refundsOf(reference)) {
          paystack.settleRefund(refund.id, "processed")
          const { body, headers } = paystack.refundEvent(refund.id)
          await api.post("/hooks/payment/paystack_paystack", body, { headers })
        }
        await eventually(
          async () => (await fulfilmentService(getContainer()).listOrderRefunds({ order_id: orderId })).map((r) => r.status),
          (s) => s.every((x) => x === "processed")
        )
        expect(await orderPayout(orderId)).toMatchObject({ state: "due", commission: TOMATOES.price / 10 })
        await payOutDeliveredOrders(getContainer())
        expect(transferFor(orderId)).toMatchObject({ amount: kobo(TOMATOES.price) - Math.round(kobo(TOMATOES.price) / 10) })
      })

      it("is refunded on the job's next run when Paystack turned the refund down", async () => {
        const { orderId, groupId, reference, readyAt } = await readyOrder([[RICE.title, 2]])
        const expiredAt = Date.parse(readyAt) + 6 * DAY + MINUTE
        paystack.refuseRefunds("Insufficient balance")
        try {
          await expireUncollectedOrders(getContainer(), new Date(expiredAt))
        } finally {
          paystack.refuseRefunds(undefined)
        }
        expect((await adasOrder(groupId, orderId)).fulfilment.state).toBe("not_collected")
        expect(refundsOf(reference)).toEqual([])

        await expireUncollectedOrders(getContainer(), new Date(expiredAt + 5 * MINUTE))
        await expireUncollectedOrders(getContainer(), new Date(expiredAt + 10 * MINUTE))

        // Once, for what it still owes.
        expect(refundsOf(reference)).toEqual([kobo(2 * RICE.price)])
      })

      it("of fresh items alone is paid to the shop, with nothing refunded or restocked", async () => {
        const tomatoes = await stockOf(TOMATOES.title)
        const { orderId, groupId, reference, readyAt } = await readyOrder([[TOMATOES.title, 2]])

        await expireUncollectedOrders(getContainer(), new Date(Date.parse(readyAt) + 2 * DAY + MINUTE))

        expect((await adasOrder(groupId, orderId)).fulfilment.state).toBe("not_collected")
        expect(refundsOf(reference)).toEqual([])
        expect(await stockOf(TOMATOES.title)).toEqual({ ...tomatoes, reserved: tomatoes.reserved + 2 })
        await payOutDeliveredOrders(getContainer())
        expect(transferFor(orderId)).toMatchObject({ amount: kobo(2 * TOMATOES.price) - Math.round(kobo(2 * TOMATOES.price) / 10) })
      })
    })

    describe("the collect-by time", () => {
      it("shows in the buyer's order and the shop's ready-for-pickup list: closing on the 5th open day after Ready, or the next with fresh items", async () => {
        const dry = await readyOrder([[RICE.title, 1]])
        const fresh = await readyOrder([
          [RICE.title, 1],
          [TOMATOES.title, 1],
        ])

        // Open round the clock: the 5th day after Ready closes at its midnight.
        const dryBy = lagosMidnightAfter(dry.readyAt, 6)
        expect((await adasOrder(dry.groupId, dry.orderId)).fulfilment.collect_by).toEqual({ at: dryBy, label: expect.stringMatching(/^Collect by midnight /) })
        const freshBy = lagosMidnightAfter(fresh.readyAt, 2)
        expect((await adasOrder(fresh.groupId, fresh.orderId)).fulfilment.collect_by).toMatchObject({ at: freshBy })

        // The vendor app's list: the ready orders, read through the shop's order list.
        const { order_ids } = (await api.get("/vendor/ready-for-pickup", await owner(GROCERY))).data
        const { data } = await api.get(`/vendor/orders?${order_ids.map((id: string) => `id[]=${id}`).join("&")}`, await owner(GROCERY))
        const listed = new Map(data.orders.map((o: any) => [o.id, o.fulfilment.collect_by?.at]))
        expect(listed.get(dry.orderId)).toBe(dryBy)
        expect(listed.get(fresh.orderId)).toBe(freshBy)
      })

      it("is gone once the order is no longer waiting at the counter", async () => {
        const { orderId, groupId, readyAt } = await readyOrder([[RICE.title, 1]])

        await expireUncollectedOrders(getContainer(), new Date(Date.parse(readyAt) + 6 * DAY + MINUTE))

        expect((await adasOrder(groupId, orderId)).fulfilment.collect_by).toBeNull()
        expect((await vendorOrder(orderId)).fulfilment.collect_by).toBeNull()
      })
    })
  },
})
