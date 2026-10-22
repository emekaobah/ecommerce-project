import { Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { formatMoney } from "@oja/domain"
import { retryOwedRefunds } from "../../src/lib/refund-retry"
import seedDemoData from "../../src/scripts/seed"
import { refundOrderShareWorkflow } from "../../src/workflows/order-fulfilment/workflows/refund-order-share"
import { adminHeaders } from "../helpers/auth"
import { buyerCheckout, eventually, GROCERY, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeResend } from "../helpers/resend"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(36000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(37000 + (process.pid % 1000))
const expo = fakeExpoPush(38000 + (process.pid % 1000))
const resend = fakeResend(39000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl
process.env.RESEND_API_KEY = resend.apiKey
process.env.RESEND_API_URL = resend.apiUrl
process.env.RESEND_FROM = "Oja <orders@oja.test>"

const ADA = "ada@oja.test"
const BALANCE = "Insufficient balance"
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
/** A moment `ms` after `start`, when the retry job runs. */
const after = (start: number, ms: number) => new Date(start + ms)
/** When the retry job runs to make the first, second and third retries of a refund first refused at `start`. */
const RETRIES = [6 * MINUTE, 2 * HOUR, 9 * HOUR]

// A refund Paystack refuses is owed to the buyer until it is made: retried with backoff, then
// handed to Oja's team, who can retry it or mark it settled by hand (#16).
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
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), resend.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), resend.stop()]))
    beforeEach(async () => {
      paystack.refuseRefunds(undefined)
      expo.reset()
      resend.reset()
      await buyer.load()
    })

    const post = async (path: string, body = {}, shop: Shop = GROCERY) =>
      api.post(`/vendor/orders/${path}`, body, await buyer.owner(shop))
    const admin = () => adminHeaders(getContainer(), api)
    const owedRefunds = async () => (await api.get("/admin/owed-refunds", await admin())).data.owed_refunds as any[]
    const owedRefundOf = async (orderId: string) => (await owedRefunds()).find((o) => o.order_id === orderId)
    const retryAll = async (start: number, times: number[]) => {
      for (const ms of times) await retryOwedRefunds(getContainer(), after(start, ms))
    }

    /** Ada's device registers for pushes, as the buyer app does once she's signed in. */
    const registerAda = async () => {
      const token = pushToken()
      await api.post("/store/push-tokens", { token }, buyer.ada())
      return token
    }
    /** The pushes a device has had about a refund sent by hand, once at least `count` have arrived. */
    const refundPushesTo = (token: string, count = 1) =>
      eventually(
        async () => expo.sentTo(token).filter((m: any) => String(m.body ?? "").startsWith("Our team is sending")),
        (sent) => sent.length >= count
      )
    /** The emails Ada has had about a refund sent by hand, once at least `count` have arrived. */
    const refundEmailsToAda = (count = 1) =>
      eventually(async () => resend.sentTo(ADA).filter((e) => e.subject.includes("refund")), (sent) => sent.length >= count)
    /** The admin's notifications about a refund to send by hand for the order. */
    const adminNoticesAbout = async (displayId: number) => {
      const { data } = await buyer.query().graph({ entity: "notification", fields: ["data"], filters: { channel: "feed" } })
      return data.filter((n: any) => n.data?.title === `Refund for order #${displayId} to send by hand`)
    }
    /** The grocery's order as Ada sees it in her order history. */
    const adasOrder = async (cartId: string, orderId: string) => {
      const groupId = await buyer.orderGroupOf(cartId)
      const { order_group } = (await api.get(`/store/order-history/${groupId}`, buyer.ada())).data
      return order_group.orders.find((o: any) => o.id === orderId)
    }
    /** Paystack processes the transaction's pending refunds, and its webhook says so. */
    const settleRefunds = async (reference: string) => {
      for (const refund of paystack.refundsOf(reference).filter((r) => r.status === "pending")) {
        paystack.settleRefund(refund.id, "processed")
        await buyer.postWebhook(paystack.refundEvent(refund.id))
      }
    }

    /** Ada's paid checkout; the grocery removes one of its two bags of rice, and Paystack refuses the refund. */
    const refusedRefund = async () => {
      const { cartId, reference } = await buyer.paidCheckout()
      const orderId = await buyer.shopOrderId(GROCERY, cartId)
      await post(`${orderId}/accept`)
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await buyer.owner(GROCERY))).data
      await post(`${orderId}/pick-list/${pick_list.lines[0].id}/unavailable`, { quantity: 1 })
      paystack.refuseRefunds(BALANCE)
      const { data } = await post(`${orderId}/remove-unavailable`)
      return { cartId, reference, orderId, removed: data }
    }

    describe("a refund Paystack refuses", () => {
      it("is recorded as owed, with its amount, Paystack's reason and the attempt, and the order edit stands", async () => {
        const { orderId, reference, removed } = await refusedRefund()

        expect(removed).toMatchObject({ removed_amount: RICE.price, refund: null })
        expect(paystack.refundsOf(reference)).toEqual([])
        expect(await owedRefundOf(orderId)).toMatchObject({
          order_id: orderId,
          display_id: expect.any(Number),
          buyer: { email: ADA },
          amount: RICE.price,
          currency_code: "ngn",
          attempts: 1,
          last_error: BALANCE,
          state: "retrying",
        })
        const { order } = (await api.get(`/vendor/orders/${orderId}?fields=*items`, await buyer.owner(GROCERY))).data
        expect(order.items.map((i: any) => i.quantity)).toEqual([1])
      })
    })

    describe("the retry job", () => {
      it("retries it 5 minutes, then an hour, after each refusal, and refunds it once Paystack accepts, then stops", async () => {
        const { orderId, reference } = await refusedRefund()
        const start = Date.now()

        await retryOwedRefunds(getContainer(), after(start, 4 * MINUTE))
        expect(await owedRefundOf(orderId)).toMatchObject({ attempts: 1 })

        await retryOwedRefunds(getContainer(), after(start, 6 * MINUTE))
        expect(await owedRefundOf(orderId)).toMatchObject({ attempts: 2, last_error: BALANCE, state: "retrying" })

        paystack.refuseRefunds(undefined)
        await retryOwedRefunds(getContainer(), after(start, 30 * MINUTE))
        expect(paystack.refundsOf(reference)).toEqual([])

        await retryOwedRefunds(getContainer(), after(start, 6 * MINUTE + HOUR + MINUTE))
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([RICE.price * 100])
        expect(await owedRefundOf(orderId)).toBeUndefined()

        await retryOwedRefunds(getContainer(), after(start, 24 * HOUR))
        expect(paystack.refundsOf(reference)).toHaveLength(1)
      })

      it("hands it to Oja's team after the third retry fails: the admin is notified, and Ada told by push and email", async () => {
        const device = await registerAda()
        const { orderId, reference } = await refusedRefund()
        const start = Date.now()

        await retryAll(start, RETRIES)

        const owed = await owedRefundOf(orderId)
        expect(owed).toMatchObject({ attempts: 4, last_error: BALANCE, state: "manual", next_attempt_at: null })
        expect(await adminNoticesAbout(owed.display_id)).toHaveLength(1)
        // Handed over once: later runs of the job leave it be.
        const notify = jest.spyOn(getContainer().resolve(Modules.NOTIFICATION), "createNotifications")
        try {
          await retryOwedRefunds(getContainer(), after(start, 10 * HOUR))
          await retryOwedRefunds(getContainer(), after(start, 11 * HOUR))
          expect(notify).not.toHaveBeenCalled()
        } finally {
          notify.mockRestore()
        }
        const [push] = await refundPushesTo(device)
        expect(push).toMatchObject({
          title: `Refund for order #${owed.display_id}`,
          body: `Our team is sending your ${formatMoney(RICE.price, "ngn")} refund for your order from ${GROCERY.name}.`,
          data: { order_id: orderId },
        })
        const [email] = await refundEmailsToAda()
        expect(email.html).toContain(`Our team is sending your ${formatMoney(RICE.price, "ngn")} refund`)

        // No more retries, and Ada and the admin are told once.
        paystack.refuseRefunds(undefined)
        await retryOwedRefunds(getContainer(), after(start, 48 * HOUR))
        expect(paystack.refundsOf(reference)).toEqual([])
        expect(await adminNoticesAbout(owed.display_id)).toHaveLength(1)
        expect(await refundPushesTo(device)).toHaveLength(1)
      })

      it("hands an amount under Paystack's ₦50 minimum straight to Oja's team, without asking Paystack", async () => {
        const device = await registerAda()
        const { orderId, reference } = await refusedRefund()
        paystack.refuseRefunds(undefined)
        // The shop refunds all but ₦30 of the bag itself.
        await refundOrderShareWorkflow(getContainer()).run({ input: { order_id: orderId, amount: RICE.price - 30 } })
        await settleRefunds(reference)

        await retryOwedRefunds(getContainer(), after(Date.now(), MINUTE))

        expect(paystack.refundsOf(reference)).toHaveLength(1)
        const owed = await owedRefundOf(orderId)
        expect(owed).toMatchObject({ amount: 30, attempts: 0, state: "manual" })
        expect(await adminNoticesAbout(owed.display_id)).toHaveLength(1)
        const [push] = await refundPushesTo(device)
        expect(push.body).toContain(`Our team is sending your ${formatMoney(30, "ngn")} refund`)
      })

      it("leaves an order alone while a refund of it is still in Paystack's hands", async () => {
        const { orderId, reference } = await refusedRefund()
        paystack.refuseRefunds(undefined)
        await refundOrderShareWorkflow(getContainer()).run({ input: { order_id: orderId, amount: 100 } })

        await retryOwedRefunds(getContainer(), after(Date.now(), HOUR))

        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([100 * 100])
        expect(await owedRefundOf(orderId)).toMatchObject({ amount: RICE.price - 100, state: "retrying" })
      })

      it("doesn't count a refund that failed after Paystack made it as refused, nor make it again", async () => {
        const { orderId, reference } = await refusedRefund()
        paystack.refuseRefunds(undefined)
        // Paystack refunds it, then recording the refund on the order fails.
        const record = jest
          .spyOn(getContainer().resolve(Modules.ORDER), "addOrderTransactions")
          .mockRejectedValueOnce(new Error("Connection terminated"))
        try {
          await retryOwedRefunds(getContainer(), after(Date.now(), 6 * MINUTE))
        } finally {
          record.mockRestore()
        }

        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([RICE.price * 100])
        expect(await owedRefundOf(orderId)).toBeUndefined()
        await settleRefunds(reference)
        await retryAll(Date.now(), [...RETRIES, 24 * HOUR])
        expect(paystack.refundsOf(reference)).toHaveLength(1)
      })
    })

    describe("Oja's staff", () => {
      const settle = async (orderId: string, body: unknown) => api.post(`/admin/owed-refunds/${orderId}/settle`, body, await admin())

      it("mark one settled by hand: it is no longer retried or shown, and still comes off the shop's payout", async () => {
        const { cartId, orderId, reference } = await refusedRefund()
        const payout = async () => (await api.get(`/vendor/orders/${orderId}/payout`, await buyer.owner(GROCERY))).data.payout
        const before = await payout()

        const { data } = await settle(orderId, { method: "bank_transfer", note: "Sent from the GTB account, ref 1234" })

        expect(data.settlement).toMatchObject({
          order_id: orderId,
          amount: RICE.price,
          method: "bank_transfer",
          note: "Sent from the GTB account, ref 1234",
          settled_by: expect.any(String),
        })
        expect(await owedRefundOf(orderId)).toBeUndefined()
        expect((await adasOrder(cartId, orderId)).owed_refund).toBeNull()
        paystack.refuseRefunds(undefined)
        await retryAll(Date.now(), [HOUR, 24 * HOUR])
        expect(paystack.refundsOf(reference)).toEqual([])
        expect(await payout()).toEqual(before)
        expect(before).toMatchObject({ refunded: RICE.price })
      })

      it("retry one now, whatever its backoff", async () => {
        const { orderId, reference } = await refusedRefund()
        paystack.refuseRefunds(undefined)

        const { data } = await api.post(`/admin/owed-refunds/${orderId}/retry`, {}, await admin())

        expect(data).toMatchObject({ refunds: [expect.objectContaining({ amount: RICE.price, covers: "items" })], owed_refund: null })
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([RICE.price * 100])
      })

      it("can't retry one while a refund of the order is still in Paystack's hands", async () => {
        const { orderId, reference } = await refusedRefund()
        paystack.refuseRefunds(undefined)
        await refundOrderShareWorkflow(getContainer()).run({ input: { order_id: orderId, amount: 100 } })

        expect(await status(api.post(`/admin/owed-refunds/${orderId}/retry`, {}, await admin()))).toBe(409)

        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([100 * 100])
      })

      it("can't settle or retry an order that owes nothing, or settle without saying how", async () => {
        const { orderId } = await refusedRefund()
        const { cartId } = await buyer.paidCheckout()
        const owesNothing = await buyer.shopOrderId(GROCERY, cartId)

        expect(await status(settle(orderId, { method: "store_credit", note: "Credit" }))).toBe(400)
        expect(await status(settle(orderId, { method: "other" }))).toBe(400)
        expect(await status(settle(owesNothing, { method: "other", note: "Paid in cash" }))).toBe(404)
        expect(await status(api.post(`/admin/owed-refunds/${owesNothing}/retry`, {}, await admin()))).toBe(404)
        expect(await status(settle(orderId, {}))).toBe(400)
        expect(await owedRefundOf(orderId)).toMatchObject({ amount: RICE.price })
      })
    })

    describe("Ada's order", () => {
      it("shows the refund pending while it is retried, that Oja's team is sending it, and nothing once refunded", async () => {
        const { cartId, orderId } = await refusedRefund()

        // The refused attempt was never made, so it isn't a refund that failed.
        expect(await adasOrder(cartId, orderId)).toMatchObject({ owed_refund: { amount: RICE.price, state: "retrying" }, refund: null })

        await retryAll(Date.now(), RETRIES)
        expect((await adasOrder(cartId, orderId)).owed_refund).toEqual({ amount: RICE.price, state: "manual" })

        paystack.refuseRefunds(undefined)
        await api.post(`/admin/owed-refunds/${orderId}/retry`, {}, await admin())
        expect(await adasOrder(cartId, orderId)).toMatchObject({ owed_refund: null, refund: { amount: RICE.price, status: "pending" } })
      })
    })

    it("is for Oja's staff only", async () => {
      expect(await status(api.get("/admin/owed-refunds", await buyer.owner(GROCERY)))).toBe(401)
    })
  },
})
