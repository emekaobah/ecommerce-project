import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { fulfilmentService } from "../../src/lib/order-fulfilment"
import { flagUnmatchedRefunds } from "../../src/lib/refund-check"
import { payOutDeliveredOrders } from "../../src/lib/pay-out-orders"
import { SHOP_BANK_ACCOUNT_MODULE, type ShopBankAccountModuleService } from "../../src/modules/shop-bank-account"
import seedDemoData from "../../src/scripts/seed"
import { refundOrderShareWorkflow } from "../../src/workflows/order-fulfilment/workflows/refund-order-share"
import { buyerCheckout, eventually, GADGETS, GROCERY, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { BEST_VALUE_FEE, fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(65000 + (process.pid % 500))
const shipbubble = fakeShipbubble(62000 + (process.pid % 1000))
const expo = fakeExpoPush(47000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl

/** In kobo, as Paystack transfers it. */
const kobo = (naira: number) => Math.round(naira * 100)
/** What the shop is paid for goods the buyer kept: all of it, less Oja's 10%. */
const lessCommission = (goods: number) => kobo(goods) - Math.round(kobo(goods) / 10)
/** The grocery's order of Ada's cart: two bags of rice, delivered at the best-value rate. */
const GROCERY_GOODS = 2 * RICE.price

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      await buyer.load()
    })

    const post = async (shop: Shop, path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await buyer.owner(shop))
    const shipbubbleSays = (...args: Parameters<typeof shipbubble.webhook>) => {
      const { body, headers } = shipbubble.webhook(...args)
      return api.post("/hooks/shipbubble", body, { headers })
    }
    const paystackSays = ({ body, headers }: { body: string; headers: Record<string, string> }) =>
      api.post("/hooks/payment/paystack_paystack", body, { headers })

    /** The grocery's order of a new paid checkout of Ada's, accepted, picked, packed and its label booked. */
    const bookedOrder = async () => {
      const { cartId, reference } = await buyer.paidCheckout()
      const orderId = await buyer.shopOrderId(GROCERY, cartId)
      await post(GROCERY, `${orderId}/accept`)
      await post(GROCERY, `${orderId}/start-picking`)
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await buyer.owner(GROCERY))).data
      for (const line of pick_list.lines) await post(GROCERY, `${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      await post(GROCERY, `${orderId}/pack`)
      const { data } = await post(GROCERY, `${orderId}/book-label`)
      return { orderId, reference, waybill: data.fulfilment.shipment.waybill as string }
    }
    /** As `bookedOrder`, then handed to the courier and delivered. */
    const deliveredOrder = async () => {
      const booked = await bookedOrder()
      await shipbubbleSays(booked.waybill, "confirmed")
      await post(GROCERY, `${booked.orderId}/hand-over`)
      await shipbubbleSays(booked.waybill, "picked_up")
      await shipbubbleSays(booked.waybill, "completed")
      return booked
    }

    /** The transfer paying out an order, if any. */
    const transferFor = (orderId: string) => paystack.transfers().find((t) => t.reference === `payout_${orderId}`.toLowerCase())
    const shopPayouts = async (shop: Shop) => (await api.get("/vendor/payouts", await buyer.owner(shop))).data.payouts as any[]
    const orderPayout = async (orderId: string) =>
      (await api.get(`/vendor/orders/${orderId}/payout`, await buyer.owner(GROCERY))).data.payout
    const recipientOf = async (shop: Shop) => {
      const [account] = await getContainer()
        .resolve<ShopBankAccountModuleService>(SHOP_BANK_ACCOUNT_MODULE)
        .listShopBankAccounts({ seller_id: await buyer.sellerId(shop) })
      return account.recipient_code
    }
    /** The order's refund settled by Paystack, as its webhook tells us. */
    const settleRefunds = async (reference: string, status: "processed" | "failed") => {
      for (const refund of paystack.refundsOf(reference).filter((r) => r.status === "pending")) {
        paystack.settleRefund(refund.id, status)
        await paystackSays(paystack.refundEvent(refund.id))
      }
    }
    const refundStatuses = async (orderId: string) =>
      (await fulfilmentService(getContainer()).listOrderRefunds({ order_id: orderId })).map((r) => r.status)

    describe("paying out delivered orders", () => {
      it("transfers what the buyer paid for the goods less 10% to the shop's bank; Oja keeps the delivery fee and pays Paystack's fees", async () => {
        const { orderId } = await deliveredOrder()

        await payOutDeliveredOrders(getContainer())

        expect(transferFor(orderId)).toMatchObject({
          amount: lessCommission(GROCERY_GOODS),
          currency: "NGN",
          recipient: await recipientOf(GROCERY),
          reason: expect.stringMatching(/^Oja order #\d+$/),
          status: "pending",
        })
        // The shop sees it on the vendor panel's Payouts page.
        const payout = (await shopPayouts(GROCERY)).find((p) => p.data?.order_id === orderId)
        expect(payout).toMatchObject({ amount: lessCommission(GROCERY_GOODS) / 100, currency_code: "ngn", status: "pending" })
        expect((await shopPayouts(GADGETS)).find((p) => p.data?.order_id === orderId)).toBeUndefined()
      })

      it("pays only delivered orders, and each once", async () => {
        const booked = await bookedOrder()
        const delivered = await deliveredOrder()

        await payOutDeliveredOrders(getContainer())
        await payOutDeliveredOrders(getContainer())

        expect(transferFor(booked.orderId)).toBeUndefined()
        expect(paystack.transfers().filter((t) => t.reference === transferFor(delivered.orderId)?.reference)).toHaveLength(1)
      })

      it("tries an order again on the next run when Paystack turns its transfer down", async () => {
        const { orderId } = await deliveredOrder()
        paystack.refuseTransfers("Your balance is not enough to fulfil this request")
        try {
          await payOutDeliveredOrders(getContainer())
        } finally {
          paystack.refuseTransfers(undefined)
        }
        expect(transferFor(orderId)).toBeUndefined()
        expect((await orderPayout(orderId)).state).toBe("due")

        await payOutDeliveredOrders(getContainer())

        expect(transferFor(orderId)).toMatchObject({ amount: lessCommission(GROCERY_GOODS) })
      })
    })

    describe("transfer webhooks", () => {
      const statusOf = async (orderId: string) => (await shopPayouts(GROCERY)).find((p) => p.data?.order_id === orderId)?.status

      it("mark the payout paid when Paystack says the transfer succeeded", async () => {
        const { orderId } = await deliveredOrder()
        await payOutDeliveredOrders(getContainer())
        const { reference } = transferFor(orderId)!

        paystack.settleTransfer(reference, "success")
        expect((await paystackSays(paystack.transferEvent(reference))).status).toBe(200)

        expect(await eventually(() => statusOf(orderId), (s) => s === "paid")).toBe("paid")
        expect((await orderPayout(orderId)).state).toBe("paid")
      })

      it("mark the payout failed when the transfer failed or was reversed", async () => {
        const failed = await deliveredOrder()
        const reversed = await deliveredOrder()
        await payOutDeliveredOrders(getContainer())

        paystack.settleTransfer(transferFor(failed.orderId)!.reference, "failed")
        paystack.settleTransfer(transferFor(reversed.orderId)!.reference, "reversed")
        await paystackSays(paystack.transferEvent(transferFor(failed.orderId)!.reference))
        await paystackSays(paystack.transferEvent(transferFor(reversed.orderId)!.reference))

        expect(await eventually(() => statusOf(failed.orderId), (s) => s === "failed")).toBe("failed")
        expect(await eventually(() => statusOf(reversed.orderId), (s) => s === "failed")).toBe("failed")
      })

      it("are taken on Paystack's word only: a webhook claiming success for a pending transfer changes nothing", async () => {
        const { orderId } = await deliveredOrder()
        await payOutDeliveredOrders(getContainer())
        const { reference } = transferFor(orderId)!
        paystack.settleTransfer(reference, "success")
        const claim = paystack.transferEvent(reference)
        paystack.settleTransfer(reference, "pending")

        await paystackSays(claim)
        await new Promise((resolve) => setTimeout(resolve, 1000))

        expect(await statusOf(orderId)).toBe("pending")
      })

      it("are refused with a bad signature", async () => {
        const { orderId } = await deliveredOrder()
        await payOutDeliveredOrders(getContainer())
        const { reference } = transferFor(orderId)!
        paystack.settleTransfer(reference, "success")

        const forged = paystack.transferEvent(reference, { signedWith: "sk_test_forged" })
        const status = await paystackSays(forged).then(
          () => 200,
          (e: any) => e.response?.status
        )

        expect(status).toBe(401)
      })
    })

    describe("refunds", () => {
      it("pays a delivered order with a refund its total less the refund, less 10% of the rest", async () => {
        const { orderId, reference } = await deliveredOrder()
        await refundOrderShareWorkflow(getContainer()).run({ input: { order_id: orderId, amount: RICE.price } })
        await settleRefunds(reference, "processed")
        await eventually(() => refundStatuses(orderId), (s) => s.every((x) => x === "processed"))

        await payOutDeliveredOrders(getContainer())

        expect(transferFor(orderId)).toMatchObject({ amount: lessCommission(GROCERY_GOODS - RICE.price) })
        expect(await orderPayout(orderId)).toMatchObject({
          paid: GROCERY_GOODS + BEST_VALUE_FEE,
          refunded: RICE.price,
          delivery: BEST_VALUE_FEE,
          commission: (GROCERY_GOODS - RICE.price) / 10,
          amount: lessCommission(GROCERY_GOODS - RICE.price) / 100,
          commission_percent: 10,
          state: "pending",
        })
      })

      it("holds an order's payout until its refund settles", async () => {
        const { orderId, reference } = await deliveredOrder()
        await refundOrderShareWorkflow(getContainer()).run({ input: { order_id: orderId, amount: RICE.price } })

        await payOutDeliveredOrders(getContainer())

        expect(transferFor(orderId)).toBeUndefined()
        expect((await orderPayout(orderId)).state).toBe("waiting_for_refund")

        await settleRefunds(reference, "processed")
        await eventually(() => refundStatuses(orderId), (s) => s.every((x) => x === "processed"))
        await payOutDeliveredOrders(getContainer())

        expect(transferFor(orderId)).toMatchObject({ amount: lessCommission(GROCERY_GOODS - RICE.price) })
      })

      it("takes a refund made after an order was paid out from the shop's next payout", async () => {
        const first = await deliveredOrder()
        await payOutDeliveredOrders(getContainer())
        await refundOrderShareWorkflow(getContainer()).run({ input: { order_id: first.orderId, amount: RICE.price } })
        await settleRefunds(first.reference, "processed")
        await eventually(() => refundStatuses(first.orderId), (s) => s.every((x) => x === "processed"))
        const second = await deliveredOrder()

        await payOutDeliveredOrders(getContainer())

        // The shop was paid 90% of the refunded rice for the first order; the second pays it back.
        const owed = lessCommission(RICE.price)
        expect(transferFor(second.orderId)).toMatchObject({ amount: lessCommission(GROCERY_GOODS) - owed })
        expect(await orderPayout(second.orderId)).toMatchObject({
          amount: lessCommission(GROCERY_GOODS) / 100,
          recovered: owed / 100,
          transferred: (lessCommission(GROCERY_GOODS) - owed) / 100,
        })

        // Taken back once only.
        const third = await deliveredOrder()
        await payOutDeliveredOrders(getContainer())
        expect(transferFor(third.orderId)).toMatchObject({ amount: lessCommission(GROCERY_GOODS) })
      })
    })

    describe("checking Paystack's refunds", () => {
      it("flags a Paystack refund no order refund records, such as one made by hand, and not Oja's own", async () => {
        const start = new Date(Date.now() - 1000).toISOString()
        const ours = await deliveredOrder()
        await refundOrderShareWorkflow(getContainer()).run({ input: { order_id: ours.orderId, amount: RICE.price } })
        const byHand = await buyer.paidCheckout()
        // ₦100, in kobo.
        const manual = paystack.refundByHand(byHand.reference, 10000)

        const flagged = await flagUnmatchedRefunds(getContainer(), { from: start, to: new Date(Date.now() + 1000).toISOString() })

        expect(flagged).toEqual([
          expect.objectContaining({ id: manual.id, amount: 100, currency: "NGN", transaction: expect.any(String) }),
        ])
        const { data } = await buyer.query().graph({ entity: "notification", fields: ["channel", "data"], filters: { channel: "feed" } })
        expect(data).toContainEqual(
          expect.objectContaining({ data: expect.objectContaining({ description: expect.stringContaining(`Paystack refund ${manual.id}`) }) })
        )
      })
    })

    describe("the vendor panel", () => {
      it("shows each order's commission: 10% of its goods, never of delivery", async () => {
        const { cartId } = await buyer.paidCheckout()
        const orderId = await buyer.shopOrderId(GROCERY, cartId)

        const lines = await eventually(
          async () => (await api.get(`/vendor/orders/${orderId}/commission-lines`, await buyer.owner(GROCERY))).data.commission_lines as any[],
          (l) => l.length > 0
        )

        expect(lines.reduce((sum, l) => sum + Number(l.amount), 0)).toBeCloseTo(GROCERY_GOODS / 10, 2)
      })

      it("shows an order's payout before it is due: what it will be, and that it waits for delivery", async () => {
        const { orderId } = await bookedOrder()

        expect(await orderPayout(orderId)).toMatchObject({
          state: "not_due",
          paid: GROCERY_GOODS + BEST_VALUE_FEE,
          delivery: BEST_VALUE_FEE,
          commission: GROCERY_GOODS / 10,
          amount: lessCommission(GROCERY_GOODS) / 100,
          recovered: null,
          transferred: null,
        })
      })

      it("shows another shop's order's payout to no one", async () => {
        const { orderId } = await bookedOrder()

        const status = await api.get(`/vendor/orders/${orderId}/payout`, await buyer.owner(GADGETS)).then(
          () => 200,
          (e: any) => e.response?.status
        )

        expect(status).toBe(404)
      })
    })
  },
})
