import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import seedDemoData from "../../src/scripts/seed"
import { rejectOverdueOrders } from "../../src/lib/order-acceptance"
import { fulfilmentService } from "../../src/lib/order-fulfilment"
import { buyerCheckout, eventually, GADGETS, GROCERY, LANTERN, ORDER_TOTALS, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { ALWAYS_OPEN, keepShopsOpen } from "../helpers/shop-hours"
import { fakePaystack } from "../helpers/paystack"
import { BEST_VALUE_FEE, COURIERS, fakeShipbubble, LATER_PICKUP_TIME } from "../helpers/shipbubble"
import { setWeeklyHours } from "../../src/lib/shop-hours"
import { WEEKDAYS } from "@oja/domain"
import { MercurModules } from "@mercurjs/types"

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

    describe("in progress and past, and search (#54)", () => {
      /** A buyer of their own, so only the checkouts a test makes are theirs. */
      const newBuyer = async (name: string) => {
        const other = buyerCheckout({ api, getContainer, clerk, paystack, email: `${name}-${Date.now()}@oja.test` })
        await other.load()
        return other
      }
      /** The buyer pays for a checkout of the gadget hub's lantern and the grocery's rice, or the lantern alone. */
      const checkout = async (who: typeof buyer, { lanternOnly = false } = {}) => {
        let cartId: string
        let reference: string
        if (lanternOnly) {
          cartId = (await api.post("/store/carts", { region_id: who.regionId() }, who.ada())).data.cart.id
          await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await who.offerId(GADGETS, LANTERN.title), quantity: 1 }, who.ada())
          await who.prepare(cartId)
          reference = (await who.startPayment(cartId)).reference
          paystack.pay(reference)
          await who.postWebhook(paystack.chargeSuccess(reference))
          await who.capturedWithin(cartId)
        } else {
          ;({ cartId, reference } = await who.paidCheckout())
        }
        const shopOrder = (shop: Shop) => who.shopOrderId(shop, cartId)
        return {
          reference,
          groupId: await who.orderGroupOf(cartId),
          gadgets: await shopOrder(GADGETS),
          grocery: lanternOnly ? null : await shopOrder(GROCERY),
        }
      }
      const listed = async (who: typeof buyer, params: Record<string, string | number>) =>
        (await api.get(`/store/order-history?${new URLSearchParams(params as Record<string, string>)}`, who.ada())).data
      const ids = (page: { order_groups: { id: string }[] }) => page.order_groups.map((g) => g.id)

      it("keeps a checkout in progress until every shop's order in it is final, then it is past", async () => {
        const cy = await newBuyer("cy")
        const { groupId, gadgets, grocery } = await checkout(cy)

        expect(ids(await listed(cy, { phase: "in_progress" }))).toEqual([groupId])
        expect(ids(await listed(cy, { phase: "past" }))).toEqual([])

        // One shop's order is final, with its refund on its way: the other shop is still preparing hers.
        await reject(GADGETS, gadgets, "Out of stock")
        expect(ids(await listed(cy, { phase: "in_progress" }))).toEqual([groupId])
        expect(ids(await listed(cy, { phase: "past" }))).toEqual([])

        // Both final; the refunds still moving don't hold the checkout.
        await reject(GROCERY, grocery!, "Out of stock")
        expect(ids(await listed(cy, { phase: "in_progress" }))).toEqual([])
        const past = await listed(cy, { phase: "past" })
        expect(ids(past)).toEqual([groupId])
        expect(past.order_groups[0].orders.map((o: any) => o.refund?.status)).toEqual(["pending", "pending"])
      })

      it("keeps a final checkout in progress while a refund of it waits on the buyer's bank account", async () => {
        const dee = await newBuyer("dee")
        const { reference, groupId, gadgets, grocery } = await checkout(dee)
        await reject(GADGETS, gadgets, "Out of stock")
        await reject(GROCERY, grocery!, "Out of stock")
        // The grocery's refund, made second.
        const [, refund] = paystack.refundsOf(reference)

        paystack.settleRefund(refund!.id, "needs-attention")
        await dee.postWebhook(paystack.refundEvent(refund!.id))
        await eventually(
          () => fulfilmentService(getContainer()).listOrderRefunds({ order_id: grocery!, status: "needs-attention" }),
          (rows) => rows.length > 0
        )

        expect(ids(await listed(dee, { phase: "in_progress" }))).toEqual([groupId])
        expect(ids(await listed(dee, { phase: "past" }))).toEqual([])
      })

      it("lists every checkout in progress at once, and pages past checkouts newest first", async () => {
        const eve = await newBuyer("eve")
        const finished: string[] = []
        for (let i = 0; i < 3; i++) {
          const placed = await checkout(eve)
          await reject(GADGETS, placed.gadgets, "Closed")
          await reject(GROCERY, placed.grocery!, "Closed")
          finished.push(placed.groupId)
        }
        const open = [(await checkout(eve)).groupId, (await checkout(eve)).groupId]

        const inProgress = await listed(eve, { phase: "in_progress", limit: 1 })
        expect(ids(inProgress)).toEqual([...open].reverse())
        expect(inProgress.count).toBe(2)

        const first = await listed(eve, { phase: "past", limit: 2, offset: 0 })
        const second = await listed(eve, { phase: "past", limit: 2, offset: 2 })
        expect(ids(first)).toEqual([finished[2], finished[1]])
        expect(ids(second)).toEqual([finished[0]])
        expect([first.count, second.count]).toEqual([3, 3])
      })

      it("finds checkouts by an item's name, in either phase, newest first, whatever its case", async () => {
        const fay = await newBuyer("fay")
        const finished = await checkout(fay)
        await reject(GADGETS, finished.gadgets, "Closed")
        await reject(GROCERY, finished.grocery!, "Closed")
        const lanternOnly = await checkout(fay, { lanternOnly: true })
        const both = await checkout(fay)

        const rice = await listed(fay, { q: "ofada RICE" })
        expect(ids(rice)).toEqual([both.groupId, finished.groupId])
        expect(rice.count).toBe(2)
        expect(ids(await listed(fay, { q: "lantern" }))).toEqual([both.groupId, lanternOnly.groupId, finished.groupId])
        expect(ids(await listed(fay, { q: "lantern", limit: 1, offset: 1 }))).toEqual([lanternOnly.groupId])
        expect(ids(await listed(fay, { q: "palm oil" }))).toEqual([])
      })

      it("pages a search of the checkouts in progress", async () => {
        const gus = await newBuyer("gus")
        const older = await checkout(gus)
        const newer = await checkout(gus)

        const first = await listed(gus, { phase: "in_progress", q: "lantern", limit: 1, offset: 0 })
        const second = await listed(gus, { phase: "in_progress", q: "lantern", limit: 1, offset: 1 })

        expect([ids(first), ids(second)]).toEqual([[newer.groupId], [older.groupId]])
        expect([first.count, first.limit, second.offset]).toEqual([2, 1, 1])
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

      it("shows each shop's logo and banner, or nulls when it has none", async () => {
        const sellers = getContainer().resolve(MercurModules.SELLER) as any
        const [gadgets] = await sellers.listSellers({ name: GADGETS.name })
        const [grocery] = await sellers.listSellers({ name: GROCERY.name })
        await sellers.updateSellers({ id: gadgets.id, logo: "https://cdn.oja.test/logo.png", banner: "https://cdn.oja.test/banner.jpg" })
        await sellers.updateSellers({ id: grocery.id, logo: null, banner: null })
        const { groupId } = await paidGroup()

        const images = (orders: any[]) => Object.fromEntries(orders.map((o: any) => [o.seller.name, [o.seller.logo, o.seller.banner]]))
        const expected = {
          [GADGETS.name]: ["https://cdn.oja.test/logo.png", "https://cdn.oja.test/banner.jpg"],
          [GROCERY.name]: [null, null],
        }
        expect(images((await orderGroup(groupId)).orders)).toEqual(expected)
        expect(images((await history()).find((g: any) => g.id === groupId).orders)).toEqual(expected)
      })

      it("is not found for any other buyer, or a guest", async () => {
        const { groupId } = await paidGroup()

        expect(await status(api.get(`/store/order-history/${groupId}`, buyer.as("ben@oja.test")))).toBe(404)
        expect(await status(api.get(`/store/order-history/${groupId}`, { headers: buyer.headers() }))).toBe(401)
      })
    })

    describe("each shop's order", () => {
      it("is new until its shop accepts it, which starts picking it", async () => {
        const { groupId, gadgets, grocery } = await paidGroup()
        await accept(GROCERY, grocery)

        expect((await sellerOrder(groupId, gadgets)).fulfilment).toMatchObject({ state: "new", rejected_by: null, reject_reason: null })
        expect((await sellerOrder(groupId, grocery)).fulfilment).toMatchObject({ state: "picking" })
        const listed = (await history()).find((g: any) => g.id === groupId)
        expect(listed.orders.map((o: any) => o.fulfilment.state).sort()).toEqual(["new", "picking"])
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
            switched_from: null,
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

      /** Ada's checkout paid with a grocery code taking a tenth off its items, VAT included. */
      const discountedCheckout = async (code: string) => {
        await api.post(
          "/vendor/promotions",
          {
            code,
            type: "standard",
            status: "active",
            is_tax_inclusive: true,
            application_method: { type: "percentage", target_type: "items", allocation: "across", value: 10 },
          },
          await buyer.owner(GROCERY)
        )
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        await api.post(`/store/carts/${cartId}/checkout/promo-codes`, { code }, buyer.ada())
        const { reference } = await buyer.startPayment(cartId)
        paystack.pay(reference)
        await buyer.postWebhook(paystack.chargeSuccess(reference))
        const groupId = await buyer.orderGroupOf(cartId)
        await buyer.capturedWithin(cartId)
        return { cartId, reference, groupId }
      }
      const receipt = (o: any) => [o.item_subtotal, o.delivery_total, o.discount_total, o.paid_total, o.payment_reference]

      it("shows its receipt: the items, delivery and the shop's discount add up to what was paid, with the Paystack reference", async () => {
        const { cartId, reference, groupId } = await discountedCheckout(`RECEIPT${process.pid}`)

        const grocery = await sellerOrder(groupId, await buyer.shopOrderId(GROCERY, cartId))
        const gadgets = await sellerOrder(groupId, await buyer.shopOrderId(GADGETS, cartId))

        // Shelf prices, VAT included: the grocery's code takes a tenth off its two bags of rice.
        expect(receipt(grocery)).toEqual([2 * RICE.price, BEST_VALUE_FEE, (2 * RICE.price) / 10, 2 * RICE.price * 0.9 + BEST_VALUE_FEE, reference])
        expect(receipt(gadgets)).toEqual([LANTERN.price, BEST_VALUE_FEE, 0, LANTERN.price + BEST_VALUE_FEE, reference])
      })

      it("keeps the receipt as charged once the shop removes an item: the discount at payment, adding up to what was paid", async () => {
        const { cartId, reference, groupId } = await discountedCheckout(`RECEIPTCUT${process.pid}`)
        const orderId = await buyer.shopOrderId(GROCERY, cartId)
        await accept(GROCERY, orderId)
        const vendor = await buyer.owner(GROCERY)
        const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, vendor)).data
        await api.post(`/vendor/orders/${orderId}/pick-list/${pick_list.lines[0].id}/unavailable`, { quantity: 1 }, vendor)
        await api.post(`/vendor/orders/${orderId}/remove-unavailable`, {}, vendor)

        const grocery = await sellerOrder(groupId, orderId)

        expect(receipt(grocery)).toEqual([2 * RICE.price, BEST_VALUE_FEE, (2 * RICE.price) / 10, 2 * RICE.price * 0.9 + BEST_VALUE_FEE, reference])
        // The removed bag's refund shows apart, as a refund of its line: what the edit took off the
        // order's total, which Medusa works out with the discount worked out again on what is left.
        expect(grocery.items[0]).toMatchObject({ quantity: 1, unavailable_quantity: 1 })
        expect(grocery.refunds).toEqual([{ amount: RICE.price, status: "pending", lines: [{ item_id: grocery.items[0].id, quantity: 1 }] }])
      })

      it("names each line's variant, so it can be ordered again", async () => {
        const { groupId, grocery } = await paidGroup()
        const { data } = await buyer.query().graph({ entity: "product", fields: ["variants.id"], filters: { title: RICE.title } })

        const [line] = (await sellerOrder(groupId, grocery)).items

        expect(line).toMatchObject({ product_title: RICE.title, variant_id: data[0].variants[0].id })
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
        // The refund of a rejected order is for every line on it (#61).
        const [lantern] = rejected.items
        expect(rejected.items).toHaveLength(1)
        expect(rejected.refunds).toEqual([
          { amount: ORDER_TOTALS.get(GADGETS), status: "pending", lines: [{ item_id: lantern.id, quantity: lantern.quantity }] },
        ])
        const other = await sellerOrder(groupId, grocery)
        expect(other.fulfilment.state).toBe("new")
        expect(other.paid_total).toBe(ORDER_TOTALS.get(GROCERY))
        expect(other.refund).toBeNull()
        expect(other.refunds).toEqual([])
      })

      it("shows an order the accept deadline rejected as not accepted in time", async () => {
        const { groupId, gadgets, grocery } = await paidGroup()
        await accept(GROCERY, grocery)
        const placedAt = Date.parse((await sellerOrder(groupId, gadgets)).created_at)

        await rejectOverdueOrders(getContainer(), new Date(placedAt + 24 * HOUR + 1000))

        const rejected = await sellerOrder(groupId, gadgets)
        expect(rejected.fulfilment).toMatchObject({ state: "rejected", rejected_by: "accept_deadline" })
        expect(rejected.refund).toEqual({ amount: ORDER_TOTALS.get(GADGETS), status: "pending" })
        expect((await sellerOrder(groupId, grocery)).fulfilment.state).toBe("picking")
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
