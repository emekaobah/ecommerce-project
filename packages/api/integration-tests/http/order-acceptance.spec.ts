import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { refundUnclaimedPayments, rejectOverdueOrders } from "../../src/lib/order-acceptance"
import { backfillOrderFulfilments, fulfilmentService } from "../../src/lib/order-fulfilment"
import { SHOP_HOURS_MODULE, type ShopHoursModuleService } from "../../src/modules/shop-hours"
import { buyerCheckout, eventually, GADGETS, GROCERY, ORDER_TOTALS, TOTAL, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { keepShopsOpen } from "../helpers/shop-hours"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so the fake can be named in the config before it is listening.
const paystack = fakePaystack(49000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(50000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

const HOUR = 60 * 60 * 1000
const ORDER_FIELDS = "+total,+created_at,+status"

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
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
      // The accept deadline counts the shops' open hours (ADR 0004); open round the clock, it is 24 hours.
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(() => buyer.load())

    /** Ada's paid checkout, and each shop's order of it. */
    const paidOrders = async () => {
      const { cartId, reference } = await buyer.paidCheckout()
      return {
        cartId,
        reference,
        gadgets: await buyer.shopOrderId(GADGETS, cartId),
        grocery: await buyer.shopOrderId(GROCERY, cartId),
      }
    }
    const shopOrder = async (shop: Shop, orderId: string) =>
      (await api.get(`/vendor/orders/${orderId}?fields=${ORDER_FIELDS}`, await buyer.owner(shop))).data.order
    const accept = async (shop: Shop, orderId: string) =>
      api.post(`/vendor/orders/${orderId}/accept`, {}, await buyer.owner(shop))
    const reject = async (shop: Shop, orderId: string, reason = "Out of stock") =>
      api.post(`/vendor/orders/${orderId}/reject`, { reason }, await buyer.owner(shop))
    /** The money the shop's order view shows paid: captured less refunded. */
    const paidOnOrder = (order: any) => {
      const [collection] = order.payment_collections
      return { captured: collection.captured_amount, refunded: collection.refunded_amount }
    }
    const orderRefunds = (orderId: string) => fulfilmentService(getContainer()).listOrderRefunds({ order_id: orderId })

    describe("accepting", () => {
      it("shows a placed order as new, with its accept deadline 24 hours on", async () => {
        const { gadgets } = await paidOrders()

        const order = await shopOrder(GADGETS, gadgets)

        expect(order.fulfilment).toEqual({
          method: "delivery",
          state: "new",
          accept_by: new Date(Date.parse(order.created_at) + 24 * HOUR).toISOString(),
          rejected_by: null,
          reject_reason: null,
          cancellation: null,
          shipment: null,
          courier_approval: null,
          handover: null,
          collection: null,
          collect_by: null,
          timeline: expect.arrayContaining([{ label: "Placed", status: "current", at: new Date(order.created_at).toISOString() }]),
        })
      })

      it("moves a new order to accepted", async () => {
        const { gadgets } = await paidOrders()

        const { data } = await accept(GADGETS, gadgets)

        expect(data.fulfilment).toMatchObject({ state: "accepted", accept_by: null })
        expect((await shopOrder(GADGETS, gadgets)).fulfilment.state).toBe("accepted")
        const listed = (await api.get(`/vendor/orders?limit=50`, await buyer.owner(GADGETS))).data.orders
        expect(listed.find((o: any) => o.id === gadgets).fulfilment.state).toBe("accepted")
      })

      it("refuses to accept or reject an order that isn't new", async () => {
        const { gadgets } = await paidOrders()
        await accept(GADGETS, gadgets)

        expect(await status(accept(GADGETS, gadgets))).toBe(400)
        expect(await status(reject(GADGETS, gadgets))).toBe(400)
        expect((await shopOrder(GADGETS, gadgets)).fulfilment.state).toBe("accepted")
        expect(await orderRefunds(gadgets)).toEqual([])
      })

      it("is for the order's own shop only", async () => {
        const { gadgets } = await paidOrders()

        expect(await status(accept(GROCERY, gadgets))).toBe(404)
        expect(await status(reject(GROCERY, gadgets))).toBe(404)
        expect((await shopOrder(GADGETS, gadgets)).fulfilment.state).toBe("new")
      })
    })

    describe("each shop's own orders", () => {
      const newOrders = async (shop: Shop) =>
        (await api.get("/vendor/shop-hours", await buyer.owner(shop))).data.shop_hours.new_orders as number

      it("counts only the shop's own orders waiting to be accepted", async () => {
        const before = { gadgets: await newOrders(GADGETS), grocery: await newOrders(GROCERY) }
        const { grocery } = await paidOrders()
        await accept(GROCERY, grocery)

        expect(await newOrders(GADGETS)).toBe(before.gadgets + 1)
        expect(await newOrders(GROCERY)).toBe(before.grocery)
      })

      it("shows an order placed before orders were recorded with their shop as new, once backfilled", async () => {
        const { cartId, gadgets, grocery } = await paidOrders()
        const before = await newOrders(GADGETS)
        // As an order placed before this change stood: Gadgets' with no row at all, Grocery's
        // accepted with a row that doesn't say whose order it is.
        await accept(GROCERY, grocery)
        const service = fulfilmentService(getContainer())
        const [gadgetsRow] = await service.listOrderFulfilments({ order_id: gadgets })
        const [groceryRow] = await service.listOrderFulfilments({ order_id: grocery })
        await service.deleteOrderFulfilments(gadgetsRow.id)
        await service.updateOrderFulfilments({ id: groceryRow.id, customer_id: null, seller_id: null, order_group_id: null })

        await backfillOrderFulfilments(getContainer())

        const order = await shopOrder(GADGETS, gadgets)
        expect(order.fulfilment).toMatchObject({
          method: "delivery",
          state: "new",
          accept_by: new Date(Date.parse(order.created_at) + 24 * HOUR).toISOString(),
        })
        expect(await newOrders(GADGETS)).toBe(before)
        expect((await accept(GADGETS, gadgets)).data.fulfilment.state).toBe("accepted")
        expect((await shopOrder(GROCERY, grocery)).fulfilment.state).toBe("accepted")
        const groupId = await buyer.orderGroupOf(cartId)
        const { data } = await api.get(`/store/order-history/${groupId}`, buyer.ada())
        expect(Object.fromEntries(data.order_group.orders.map((o: any) => [o.id, o.fulfilment.state]))).toEqual({
          [gadgets]: "accepted",
          [grocery]: "accepted",
        })
      })
    })

    describe("rejecting", () => {
      it("needs a reason", async () => {
        const { gadgets } = await paidOrders()

        expect(await status(reject(GADGETS, gadgets, "  "))).toBe(400)
        expect((await shopOrder(GADGETS, gadgets)).fulfilment.state).toBe("new")
      })

      it("moves a new order to rejected, cancels it and refunds exactly its share; the other shop's order keeps its payment", async () => {
        const { reference, gadgets, grocery } = await paidOrders()
        const share = ORDER_TOTALS.get(GADGETS)!
        const reservations = async () => {
          const { data } = await buyer.query().graph({ entity: "order", fields: ["items.id"], filters: { id: gadgets } })
          const lineItemIds = (data[0].items ?? []).map((item: any) => item.id)
          return getContainer().resolve(Modules.INVENTORY).listReservationItems({ line_item_id: lineItemIds })
        }
        expect(await reservations()).toHaveLength(1)

        const { data } = await reject(GADGETS, gadgets, "The lantern is out of stock")

        expect(data.fulfilment).toEqual({
          method: "delivery",
          state: "rejected",
          accept_by: null,
          rejected_by: "seller",
          reject_reason: "The lantern is out of stock",
          cancellation: null,
          shipment: null,
          courier_approval: null,
          handover: null,
          collection: null,
          collect_by: null,
          // A rejected order's status says why; it has no steps to show.
          timeline: [],
        })
        // One partial refund on the shared transaction, for the gadget hub's order alone (kobo).
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([share * 100])
        const rejected = await shopOrder(GADGETS, gadgets)
        expect(rejected.status).toBe("canceled")
        // Its stock is no longer held for it.
        expect(await reservations()).toEqual([])
        expect(paidOnOrder(rejected)).toEqual({ captured: share, refunded: share })
        // The web vendor panel shows max(0, total - (captured - refunded)) as still owed by the buyer.
        expect(Math.max(0, rejected.total - (share - share))).toBe(0)
        const other = await shopOrder(GROCERY, grocery)
        expect(other.fulfilment.state).toBe("new")
        expect(paidOnOrder(other)).toEqual({ captured: ORDER_TOTALS.get(GROCERY), refunded: 0 })
      })

      it("refunds only its share of an order linked to its payment, as an order paid on its own is (#65)", async () => {
        const { cartId, reference, gadgets } = await paidOrders()
        const { data } = await buyer.query().graph({ entity: "cart", fields: ["payment_collection.id"], filters: { id: cartId } })
        await getContainer()
          .resolve(ContainerRegistrationKeys.LINK)
          .create({
            [Modules.ORDER]: { order_id: gadgets },
            [Modules.PAYMENT]: { payment_collection_id: data[0].payment_collection!.id },
          })

        await reject(GADGETS, gadgets)

        // Medusa's own cancel would refund every payment linked to the order, in full.
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([ORDER_TOTALS.get(GADGETS)! * 100])
        expect((await shopOrder(GADGETS, gadgets)).status).toBe("canceled")
      })

      it("records the refund against the order, with Paystack's refund id", async () => {
        const { reference, gadgets } = await paidOrders()

        await reject(GADGETS, gadgets)

        const [paystackRefund] = paystack.refundsOf(reference)
        const [refund] = await orderRefunds(gadgets)
        expect(refund).toMatchObject({
          order_id: gadgets,
          amount: ORDER_TOTALS.get(GADGETS),
          transaction_reference: reference,
          paystack_refund_id: String(paystackRefund.id),
          status: "pending",
        })
        expect(paystackRefund.merchant_note).toBe(refund.refund_id)
        const transactions = await getContainer()
          .resolve(Modules.ORDER)
          .listOrderTransactions({ order_id: gadgets, reference: "refund" })
        expect(transactions.map((t) => [t.reference_id, Number(t.amount)])).toEqual([
          [refund.refund_id, -ORDER_TOTALS.get(GADGETS)!],
        ])
      })

      it("leaves the order rejected when Paystack turns the refund down, and the job refunds it later", async () => {
        const { reference, gadgets } = await paidOrders()
        paystack.refuseRefunds("Insufficient balance")
        try {
          expect((await reject(GADGETS, gadgets)).data.fulfilment.state).toBe("rejected")
          expect(paystack.refundsOf(reference)).toEqual([])
          expect(paidOnOrder(await shopOrder(GADGETS, gadgets)).refunded).toBe(0)
        } finally {
          paystack.refuseRefunds(undefined)
        }

        await rejectOverdueOrders(getContainer())

        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([ORDER_TOTALS.get(GADGETS)! * 100])
        expect(paidOnOrder(await shopOrder(GADGETS, gadgets)).refunded).toBe(ORDER_TOTALS.get(GADGETS))
      })
    })

    describe("acting on an order the moment it appears", () => {
      /**
       * The shop's order of a checkout Paystack has just paid for, as soon as the shop can see it:
       * Mercur's checkout workflow may still be running, and `order.placed`, which records the
       * order as New, is only sent once it finishes.
       */
      const justPlaced = async (shop: Shop) => {
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        const { reference } = await buyer.startPayment(cartId)
        paystack.pay(reference)
        const webhook = buyer.postWebhook(paystack.chargeSuccess(reference))
        const sellerId = await buyer.sellerId(shop)
        // Polled tightly: the window between the order appearing and being recorded is short.
        for (let tries = 0; tries < 4000; tries++) {
          const orderIds = (await buyer.ordersOfCart(cartId)).map((c) => c.order_id)
          const { data } = orderIds.length
            ? await buyer
                .query()
                .graph({ entity: "order_seller", fields: ["order_id"], filters: { seller_id: sellerId, order_id: orderIds } })
            : { data: [] }
          const orderId = data[0]?.order_id as string | undefined
          if (orderId) return { orderId, settled: webhook }
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        throw new Error(`${shop.name}'s order of cart ${cartId} never appeared`)
      }

      it("isn't refused because the order is still being recorded", async () => {
        // A race: each round is a chance for the shop's action and the recording to collide.
        for (let round = 0; round < 6; round++) {
          const { orderId, settled } = await justPlaced(GADGETS)
          paystack.refuseRefunds("Insufficient balance")
          try {
            expect(await status(reject(GADGETS, orderId))).toBe(200)
          } finally {
            paystack.refuseRefunds(undefined)
          }
          await settled
        }
      })
    })

    describe("the accept deadline", () => {
      it("rejects and refunds orders not accepted within 24 hours, and leaves the others alone", async () => {
        const { reference, gadgets, grocery } = await paidOrders()
        await accept(GROCERY, grocery)
        const placedAt = Date.parse((await shopOrder(GADGETS, gadgets)).created_at)

        await rejectOverdueOrders(getContainer(), new Date(placedAt + 23 * HOUR))
        expect((await shopOrder(GADGETS, gadgets)).fulfilment.state).toBe("new")
        expect(paystack.refundsOf(reference)).toEqual([])

        await rejectOverdueOrders(getContainer(), new Date(placedAt + 24 * HOUR + 1000))

        expect((await shopOrder(GADGETS, gadgets)).fulfilment).toMatchObject({
          state: "rejected",
          rejected_by: "accept_deadline",
        })
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([ORDER_TOTALS.get(GADGETS)! * 100])
        const accepted = await shopOrder(GROCERY, grocery)
        expect(accepted.fulfilment.state).toBe("accepted")
        expect(paidOnOrder(accepted)).toEqual({ captured: ORDER_TOTALS.get(GROCERY), refunded: 0 })
      })

      it("rejects and refunds an order waiting when the shop paused until further notice at its original deadline (#18)", async () => {
        const { reference, gadgets, grocery } = await paidOrders()
        await accept(GROCERY, grocery)
        const placedAt = Date.parse((await shopOrder(GADGETS, gadgets)).created_at)
        // The gadget hub paused an hour after the order came in, and never resumed.
        const shopHours = getContainer().resolve<ShopHoursModuleService>(SHOP_HOURS_MODULE)
        const pause = await shopHours.createShopPauses({
          seller_id: await buyer.sellerId(GADGETS),
          starts_at: new Date(placedAt + HOUR),
          ends_at: null,
        })

        try {
          expect((await shopOrder(GADGETS, gadgets)).fulfilment.accept_by).toBe(new Date(placedAt + 24 * HOUR).toISOString())
          await rejectOverdueOrders(getContainer(), new Date(placedAt + 23 * HOUR))
          expect((await shopOrder(GADGETS, gadgets)).fulfilment.state).toBe("new")

          await rejectOverdueOrders(getContainer(), new Date(placedAt + 24 * HOUR + 1000))
          expect((await shopOrder(GADGETS, gadgets)).fulfilment).toMatchObject({ state: "rejected", rejected_by: "accept_deadline" })
          expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([ORDER_TOTALS.get(GADGETS)! * 100])
        } finally {
          await shopHours.deleteShopPauses(pause.id)
        }
      })
    })

    describe("payments no order claims", () => {
      const refundsOfTransaction = (reference: string) =>
        fulfilmentService(getContainer()).listOrderRefunds({ transaction_reference: reference })

      it("refunds in full a payment made on a Paystack page the buyer had since replaced, and still takes the current one", async () => {
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        // The buyer opened Paystack twice; the second page replaced the first, then they paid on the first.
        const replaced = await buyer.startPayment(cartId)
        const current = await buyer.startPayment(cartId)
        paystack.pay(replaced.reference)

        await buyer.postWebhook(paystack.chargeSuccess(replaced.reference))

        const [refund] = await eventually(() => refundsOfTransaction(replaced.reference), (rows) => rows.length > 0, 150)
        expect(paystack.refundsOf(replaced.reference).map((r) => [r.amount, r.status])).toEqual([[TOTAL * 100, "pending"]])
        expect(refund).toMatchObject({ order_id: null, amount: TOTAL, paystack_refund_id: String(paystack.refundsOf(replaced.reference)[0].id) })
        expect(await buyer.ordersOfCart(cartId)).toEqual([])

        paystack.pay(current.reference)
        await buyer.postWebhook(paystack.chargeSuccess(current.reference))
        await buyer.orderGroupOf(cartId)
        expect(paystack.refundsOf(current.reference)).toEqual([])
      })

      it("refunds in full a payment captured for a checkout that never became orders, once it has had time to, when the refund at once failed", async () => {
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        const { reference } = await buyer.startPayment(cartId)
        paystack.pay(reference)
        // The lantern sells out between paying and Paystack's webhook, so the split fails, and
        // Paystack turns down the refund made right after (#38): the job is the backstop.
        paystack.refuseRefunds("Insufficient balance")
        const inventory = getContainer().resolve(Modules.INVENTORY)
        const { data: offers } = await buyer.query().graph({
          entity: "offer",
          fields: ["inventory_item_link.inventory_item.location_levels.*"],
          filters: { id: await buyer.offerId(GADGETS, "Rechargeable LED Lantern") },
        })
        const [level] = (offers[0] as any).inventory_item_link[0].inventory_item.location_levels
        await inventory.updateInventoryLevels([
          { inventory_item_id: level.inventory_item_id, location_id: level.location_id, stocked_quantity: 0 },
        ])
        try {
          await buyer.postWebhook(paystack.chargeSuccess(reference))
          const payment = await eventually(() => buyer.paymentOf(cartId), (p) => !!p?.captured_at, 150)
          // The cart is checked, tried again and refunded a few seconds after the capture.
          await new Promise((resolve) => setTimeout(resolve, 10000))
          expect(await buyer.ordersOfCart(cartId)).toEqual([])
          expect(paystack.refundsOf(reference)).toEqual([])
          paystack.refuseRefunds(undefined)

          await refundUnclaimedPayments(getContainer())
          expect(paystack.refundsOf(reference)).toEqual([])

          await refundUnclaimedPayments(getContainer(), new Date(Date.now() + HOUR))

          expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([TOTAL * 100])
          const [refund] = await refundsOfTransaction(reference)
          expect(refund).toMatchObject({ order_id: null, payment_id: payment.id, amount: TOTAL })
          await refundUnclaimedPayments(getContainer(), new Date(Date.now() + 2 * HOUR))
          expect(paystack.refundsOf(reference)).toHaveLength(1)
        } finally {
          paystack.refuseRefunds(undefined)
          await inventory.updateInventoryLevels([
            { inventory_item_id: level.inventory_item_id, location_id: level.location_id, stocked_quantity: level.stocked_quantity },
          ])
        }
      })

      it("refunds such a payment once, however often Paystack sends its webhook", async () => {
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        const replaced = await buyer.startPayment(cartId)
        await buyer.startPayment(cartId)
        paystack.pay(replaced.reference)
        const webhook = paystack.chargeSuccess(replaced.reference)

        await buyer.postWebhook(webhook)
        await eventually(() => refundsOfTransaction(replaced.reference), (rows) => rows.length > 0, 150)
        await buyer.postWebhook(webhook)
        await new Promise((resolve) => setTimeout(resolve, 8000))

        expect(paystack.refundsOf(replaced.reference)).toHaveLength(1)
        expect(await refundsOfTransaction(replaced.reference)).toHaveLength(1)
      })
    })

    describe("refunds from the web vendor panel", () => {
      const refundFromPanel = async (shop: Shop, paymentId: string, amount: number) =>
        api.post(`/vendor/payments/${paymentId}/refund`, { amount }, await buyer.owner(shop))

      it("can't refund more than the order's share, less its earlier refunds", async () => {
        const { cartId, reference, gadgets } = await paidOrders()
        const paymentId = (await buyer.paymentOf(cartId)).id
        const share = ORDER_TOTALS.get(GADGETS)!

        expect(await status(refundFromPanel(GADGETS, paymentId, share + 1))).toBe(400)
        await refundFromPanel(GADGETS, paymentId, 1000)
        await refundFromPanel(GADGETS, paymentId, 2000)
        expect(await status(refundFromPanel(GADGETS, paymentId, share - 3000 + 1))).toBe(400)

        // Two partial refunds on the one shared transaction both went through.
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([100000, 200000])
        expect(paidOnOrder(await shopOrder(GADGETS, gadgets)).refunded).toBe(3000)
      })
    })

    describe("Paystack's refund webhooks", () => {
      const settled = async (orderId: string, status: string) =>
        (await eventually(() => orderRefunds(orderId), (refunds) => refunds[0]?.status === status, 150))[0]

      it("mark a refund processed", async () => {
        const { reference, gadgets } = await paidOrders()
        await reject(GADGETS, gadgets)
        const [refund] = paystack.refundsOf(reference)

        paystack.settleRefund(refund.id, "processed")
        await buyer.postWebhook(paystack.refundEvent(refund.id))

        await settled(gadgets, "processed")
        expect(paidOnOrder(await shopOrder(GADGETS, gadgets)).refunded).toBe(ORDER_TOTALS.get(GADGETS))
      })

      it("keep a refund that needs attention counted as refunded", async () => {
        const { reference, gadgets } = await paidOrders()
        await reject(GADGETS, gadgets)
        const [refund] = paystack.refundsOf(reference)

        paystack.settleRefund(refund.id, "needs-attention")
        await buyer.postWebhook(paystack.refundEvent(refund.id))

        await settled(gadgets, "needs-attention")
        expect(paidOnOrder(await shopOrder(GADGETS, gadgets)).refunded).toBe(ORDER_TOTALS.get(GADGETS))
      })

      it("stop showing a failed refund as refunded, so the order is refunded again", async () => {
        const { reference, cartId, gadgets } = await paidOrders()
        await reject(GADGETS, gadgets)
        const [refund] = paystack.refundsOf(reference)

        paystack.settleRefund(refund.id, "failed")
        await buyer.postWebhook(paystack.refundEvent(refund.id))

        const failed = await settled(gadgets, "failed")
        const unrefunded = await shopOrder(GADGETS, gadgets)
        expect(paidOnOrder(unrefunded).refunded).toBe(0)
        // Its credit line is gone too, so the order's total counts the money as not refunded.
        expect(unrefunded.total).toBe(ORDER_TOTALS.get(GADGETS))
        const { data } = await buyer.query().graph({ entity: "payment", fields: ["refunds.id"], filters: { id: (await buyer.paymentOf(cartId)).id } })
        expect(data[0].refunds.map((r: any) => r.id)).not.toContain(failed.refund_id)

        await rejectOverdueOrders(getContainer())

        expect(paystack.refundsOf(reference).map((r) => r.status)).toEqual(["failed", "pending"])
        const refundedAgain = await shopOrder(GADGETS, gadgets)
        expect(paidOnOrder(refundedAgain).refunded).toBe(ORDER_TOTALS.get(GADGETS))
        expect(refundedAgain.total).toBe(0)
      })
    })
  },
})
