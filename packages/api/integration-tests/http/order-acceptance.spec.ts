import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { rejectOverdueOrders } from "../../src/lib/order-acceptance"
import { fulfilmentService } from "../../src/lib/order-fulfilment"
import { buyerCheckout, eventually, GADGETS, GROCERY, ORDER_TOTALS, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so the fake can be named in the config before it is listening.
const paystack = fakePaystack(49000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl

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
      await paystack.start()
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => paystack.stop())
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
          state: "new",
          accept_by: new Date(Date.parse(order.created_at) + 24 * HOUR).toISOString(),
          rejected_by: null,
          reject_reason: null,
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

    describe("rejecting", () => {
      it("needs a reason", async () => {
        const { gadgets } = await paidOrders()

        expect(await status(reject(GADGETS, gadgets, "  "))).toBe(400)
        expect((await shopOrder(GADGETS, gadgets)).fulfilment.state).toBe("new")
      })

      it("moves a new order to rejected, cancels it and refunds exactly its share; the other shop's order keeps its payment", async () => {
        const { reference, gadgets, grocery } = await paidOrders()
        const share = ORDER_TOTALS.get(GADGETS)!

        const { data } = await reject(GADGETS, gadgets, "The lantern is out of stock")

        expect(data.fulfilment).toEqual({
          state: "rejected",
          accept_by: null,
          rejected_by: "seller",
          reject_reason: "The lantern is out of stock",
        })
        // One partial refund on the shared transaction, for the gadget hub's order alone (kobo).
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([share * 100])
        const rejected = await shopOrder(GADGETS, gadgets)
        expect(rejected.status).toBe("canceled")
        expect(paidOnOrder(rejected)).toEqual({ captured: share, refunded: share })
        const other = await shopOrder(GROCERY, grocery)
        expect(other.fulfilment.state).toBe("new")
        expect(paidOnOrder(other)).toEqual({ captured: ORDER_TOTALS.get(GROCERY), refunded: 0 })
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
        expect(paidOnOrder(await shopOrder(GADGETS, gadgets)).refunded).toBe(0)
        const { data } = await buyer.query().graph({ entity: "payment", fields: ["refunds.id"], filters: { id: (await buyer.paymentOf(cartId)).id } })
        expect(data[0].refunds.map((r: any) => r.id)).not.toContain(failed.refund_id)

        await rejectOverdueOrders(getContainer())

        expect(paystack.refundsOf(reference).map((r) => r.status)).toEqual(["failed", "pending"])
        expect(paidOnOrder(await shopOrder(GADGETS, gadgets)).refunded).toBe(ORDER_TOTALS.get(GADGETS))
      })
    })
  },
})
