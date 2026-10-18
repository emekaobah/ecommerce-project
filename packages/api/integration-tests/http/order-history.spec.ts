import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import seedDemoData from "../../src/scripts/seed"
import { rejectOverdueOrders } from "../../src/lib/order-acceptance"
import { fulfilmentService } from "../../src/lib/order-fulfilment"
import { buyerCheckout, eventually, GADGETS, GROCERY, LANTERN, ORDER_TOTALS, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { ALWAYS_OPEN, keepShopsOpen } from "../helpers/shop-hours"
import { fakePaystack } from "../helpers/paystack"
import { COURIERS, fakeShipbubble, LATER_PICKUP_TIME } from "../helpers/shipbubble"
import { setWeeklyHours } from "../../src/lib/shop-hours"
import { WEEKDAYS } from "@oja/domain"

jest.setTimeout(5 * 60 * 1000)

const HOUR = 60 * 60 * 1000

const clerk = fakeClerk()
// A port per test process, so the fakes can be named in the config before they listen.
const paystack = fakePaystack(50000 + (process.pid % 1000))
// Checkout quotes each shop's delivery with Shipbubble; ORDER_TOTALS include its best-value rate.
const shipbubble = fakeShipbubble(52000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

// The buyer's order history (#17): each checkout is an order group, split into an order per shop.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
      // The accept deadline counts the shops' open hours (ADR 0004); open round the clock, it is 24 hours.
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(() => buyer.load())

    /** Ada's paid checkout: its order group, and each shop's order of it. */
    const paidGroup = async () => {
      const { cartId, reference } = await buyer.paidCheckout()
      return {
        reference,
        groupId: await buyer.orderGroupOf(cartId),
        gadgets: await buyer.shopOrderId(GADGETS, cartId),
        grocery: await buyer.shopOrderId(GROCERY, cartId),
      }
    }
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )
    const history = async (as = buyer.ada()) => (await api.get("/store/order-history", as)).data.order_groups
    const orderGroup = async (id: string, as = buyer.ada()) => (await api.get(`/store/order-history/${id}`, as)).data.order_group
    /** The buyer's view of one shop's order in the group. */
    const sellerOrder = async (groupId: string, orderId: string) =>
      (await orderGroup(groupId)).orders.find((o: any) => o.id === orderId)
    const accept = async (shop: Shop, orderId: string) =>
      api.post(`/vendor/orders/${orderId}/accept`, {}, await buyer.owner(shop))
    const reject = async (shop: Shop, orderId: string, reason: string) =>
      api.post(`/vendor/orders/${orderId}/reject`, { reason }, await buyer.owner(shop))

    describe("the order list", () => {
      it("lists the buyer's order groups newest first, each split into its shops' orders and their items", async () => {
        const first = await paidGroup()
        const second = await paidGroup()

        const groups = await history()

        const ids = groups.map((g: any) => g.id)
        expect(ids.indexOf(second.groupId)).toBeLessThan(ids.indexOf(first.groupId))
        expect(ids.indexOf(first.groupId)).toBeGreaterThan(-1)
        const latest = groups.find((g: any) => g.id === second.groupId)
        const items = Object.fromEntries(
          latest.orders.map((o: any) => [o.seller.name, o.items.map((i: any) => [i.product_title, i.quantity])])
        )
        expect(items).toEqual({
          [GADGETS.name]: [[LANTERN.title, 1]],
          [GROCERY.name]: [[RICE.title, 2]],
        })
      })

      it("shows a buyer only their own order groups, and a guest none", async () => {
        const { groupId } = await paidGroup()

        const bens = await history(buyer.as("ben@oja.test"))

        expect(bens.map((g: any) => g.id)).not.toContain(groupId)
        expect(await status(api.get("/store/order-history", { headers: buyer.headers() }))).toBe(401)
      })
    })

    describe("an order group", () => {
      it("shows each shop's order with its items", async () => {
        const { groupId, gadgets, grocery } = await paidGroup()

        const group = await orderGroup(groupId)

        expect(group.id).toBe(groupId)
        const byShop = Object.fromEntries(group.orders.map((o: any) => [o.seller.name, o]))
        expect(byShop[GADGETS.name]).toMatchObject({ id: gadgets, items: [{ product_title: LANTERN.title, quantity: 1, unit_price: LANTERN.price }] })
        expect(byShop[GROCERY.name]).toMatchObject({ id: grocery, items: [{ product_title: RICE.title, quantity: 2, unit_price: RICE.price }] })
      })

      it("is not found for any other buyer, or a guest", async () => {
        const { groupId } = await paidGroup()

        expect(await status(api.get(`/store/order-history/${groupId}`, buyer.as("ben@oja.test")))).toBe(404)
        expect(await status(api.get(`/store/order-history/${groupId}`, { headers: buyer.headers() }))).toBe(401)
      })
    })

    describe("each shop's order", () => {
      it("is new until its shop accepts it", async () => {
        const { groupId, gadgets, grocery } = await paidGroup()
        await accept(GROCERY, grocery)

        expect((await sellerOrder(groupId, gadgets)).fulfilment).toMatchObject({ state: "new", rejected_by: null, reject_reason: null })
        expect((await sellerOrder(groupId, grocery)).fulfilment).toMatchObject({ state: "accepted" })
        const listed = (await history()).find((g: any) => g.id === groupId)
        expect(listed.orders.map((o: any) => o.fulfilment.state).sort()).toEqual(["accepted", "new"])
      })

      it("shows the delivery estimate checkout quoted, counted from when its closed shop opens, which prepares it then", async () => {
        // The gadget hub opens 8am to 6pm only on the day after tomorrow: closed now (ADR 0004).
        // Read once: past midnight the shop still opens on this date, a day nearer.
        const opensDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(Date.now() + 2 * 24 * HOUR)
        const opensOn = WEEKDAYS[(new Date(`${opensDate}T00:00:00Z`).getUTCDay() + 6) % 7]
        const gadgetsId = await buyer.sellerId(GADGETS)
        const weekly = Object.fromEntries(WEEKDAYS.map((day) => [day, day === opensOn ? [{ opens: "08:00", closes: "18:00" }] : []]))
        await setWeeklyHours(getContainer(), gadgetsId, weekly as typeof ALWAYS_OPEN)
        try {
          const { groupId, gadgets, grocery } = await paidGroup()

          const closed = await sellerOrder(groupId, gadgets)
          const open = await sellerOrder(groupId, grocery)

          // Couriers collect the morning it opens; best value arrives a day and a bit later.
          const collected = Date.parse(`${opensDate}T${LATER_PICKUP_TIME}+01:00`)
          expect(closed.delivery).toEqual({
            courier_name: COURIERS.nextDay.courier_name,
            delivery_eta_time: expect.stringMatching(/\+01:00$/),
            time_zone: "Africa/Lagos",
          })
          expect(Date.parse(closed.delivery.delivery_eta_time)).toBe(collected + COURIERS.nextDay.hours * HOUR)
          expect(closed.shop_opens).toEqual({ at: new Date(`${opensDate}T08:00:00+01:00`).toISOString(), time_zone: "Africa/Lagos" })
          expect(open.delivery).toMatchObject({ courier_name: COURIERS.nextDay.courier_name })
          expect(open.shop_opens).toBeNull()
        } finally {
          await setWeeklyHours(getContainer(), gadgetsId, ALWAYS_OPEN)
        }
      })

      it("shows what the buyer paid for it", async () => {
        const { groupId, gadgets, grocery } = await paidGroup()

        expect((await sellerOrder(groupId, gadgets)).paid_total).toBe(ORDER_TOTALS.get(GADGETS))
        expect((await sellerOrder(groupId, grocery)).paid_total).toBe(ORDER_TOTALS.get(GROCERY))
        expect((await sellerOrder(groupId, gadgets)).refund).toBeNull()
      })

      it("shows a rejected order with the shop's reason, what was paid for it and its refund on the way; the other shop's order carries on", async () => {
        const { groupId, gadgets, grocery } = await paidGroup()

        await reject(GADGETS, gadgets, "The lantern is out of stock")

        const rejected = await sellerOrder(groupId, gadgets)
        expect(rejected.fulfilment).toMatchObject({
          state: "rejected",
          rejected_by: "seller",
          reject_reason: "The lantern is out of stock",
        })
        // A refund adds a credit line, which takes it off the order's total: that alone would read ₦0 paid.
        expect(rejected.paid_total).toBe(ORDER_TOTALS.get(GADGETS))
        expect(rejected.refund).toEqual({ amount: ORDER_TOTALS.get(GADGETS), status: "pending" })
        const other = await sellerOrder(groupId, grocery)
        expect(other.fulfilment.state).toBe("new")
        expect(other.paid_total).toBe(ORDER_TOTALS.get(GROCERY))
        expect(other.refund).toBeNull()
      })

      it("shows an order the accept deadline rejected as not accepted in time", async () => {
        const { groupId, gadgets, grocery } = await paidGroup()
        await accept(GROCERY, grocery)
        const placedAt = Date.parse((await sellerOrder(groupId, gadgets)).created_at)

        await rejectOverdueOrders(getContainer(), new Date(placedAt + 24 * HOUR + 1000))

        const rejected = await sellerOrder(groupId, gadgets)
        expect(rejected.fulfilment).toMatchObject({ state: "rejected", rejected_by: "accept_deadline" })
        expect(rejected.refund).toEqual({ amount: ORDER_TOTALS.get(GADGETS), status: "pending" })
        expect((await sellerOrder(groupId, grocery)).fulfilment.state).toBe("accepted")
      })
    })

    describe("a refund", () => {
      const settle = async (reference: string, orderId: string, status: "processed" | "failed") => {
        const refund = paystack.refundsOf(reference).at(-1)!
        paystack.settleRefund(refund.id, status)
        await buyer.postWebhook(paystack.refundEvent(refund.id))
        await eventually(
          () => fulfilmentService(getContainer()).listOrderRefunds({ order_id: orderId, status }),
          (rows) => rows.length > 0,
          150
        )
      }

      it("shows refunded once Paystack has paid it back", async () => {
        const { reference, groupId, gadgets } = await paidGroup()
        await reject(GADGETS, gadgets, "Closed for a family event")

        await settle(reference, gadgets, "processed")

        expect((await sellerOrder(groupId, gadgets)).refund).toEqual({ amount: ORDER_TOTALS.get(GADGETS), status: "processed" })
      })

      it("shows delayed while a refund Paystack failed waits to be made again, and on its way once it is", async () => {
        const { reference, groupId, gadgets } = await paidGroup()
        await reject(GADGETS, gadgets, "Closed for a family event")

        await settle(reference, gadgets, "failed")

        const delayed = await sellerOrder(groupId, gadgets)
        expect(delayed.refund).toEqual({ amount: ORDER_TOTALS.get(GADGETS), status: "failed" })
        // Still what was paid: the failed refund's credit line is gone, so the total is whole again.
        expect(delayed.paid_total).toBe(ORDER_TOTALS.get(GADGETS))

        await rejectOverdueOrders(getContainer())

        const retried = await sellerOrder(groupId, gadgets)
        expect(retried.refund).toEqual({ amount: ORDER_TOTALS.get(GADGETS), status: "pending" })
        expect(retried.paid_total).toBe(ORDER_TOTALS.get(GADGETS))
      })
    })
  },
})
