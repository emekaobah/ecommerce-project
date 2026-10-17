import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { formatMoney } from "@oja/domain"
import seedDemoData from "../../src/scripts/seed"
import { statusOf } from "../helpers/checkout-suite"
import { buyerCheckout, eventually, GROCERY, ORDER_TOTALS } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { accountName, fakePaystack } from "../helpers/paystack"
import { fakeResend } from "../helpers/resend"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(46000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(47000 + (process.pid % 1000))
const expo = fakeExpoPush(48000 + (process.pid % 1000))
const resend = fakeResend(49000 + (process.pid % 1000))
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

// A refund Paystack can't return to the buyer's card needs their bank account (#13): the buyer
// is asked for one, Paystack retries the refund to it, and its webhooks carry on from there.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), resend.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), resend.stop()]))
    beforeEach(async () => {
      expo.reset()
      resend.reset()
      await buyer.load()
    })

    /** Ada's device registers for pushes, as the buyer app does once she's signed in. */
    const registerAda = async () => {
      const token = pushToken()
      await api.post("/store/push-tokens", { token }, buyer.ada())
      return token
    }
    /** The pushes a device has had asking for a bank account, once at least `count` have arrived. */
    const accountPushesTo = (token: string, count = 1) =>
      eventually(
        async () => expo.sentTo(token).filter((m: any) => String(m.data?.url ?? "").startsWith("/refund/")),
        (sent) => sent.length >= count
      )
    /** The emails Ada has had asking for a bank account, once at least `count` have arrived. */
    const accountEmailsToAda = (count = 1) =>
      eventually(async () => resend.sentTo(ADA).filter((e) => e.subject.includes("bank account")), (sent) => sent.length >= count)

    /** The order refund recorded for a Paystack refund. */
    const orderRefundOf = async (paystackRefundId: number) => {
      const { data } = await buyer.query().graph({
        entity: "order_refund",
        fields: ["*"],
        filters: { paystack_refund_id: String(paystackRefundId) },
      })
      return data[0] as any
    }

    /**
     * Ada's paid checkout; the grocery rejects its order, and Paystack can't return the refund
     * to her card: it needs her bank account, and its webhook says so.
     */
    const refundNeedingAccount = async () => {
      const { cartId, reference } = await buyer.paidCheckout()
      const orderId = await buyer.shopOrderId(GROCERY, cartId)
      await api.post(`/vendor/orders/${orderId}/reject`, { reason: "Out of stock" }, await buyer.owner(GROCERY))
      const [refund] = paystack.refundsOf(reference)
      paystack.settleRefund(refund!.id, "needs-attention")
      await buyer.postWebhook(paystack.refundEvent(refund!.id))
      const row = await eventually(
        () => orderRefundOf(refund!.id),
        (r) => r?.status === "needs-attention"
      )
      return { cartId, orderId, reference, paystackRefundId: refund!.id, refundId: row.id as string }
    }

    describe("a refund that needs attention", () => {
      it("asks Ada for her bank account by push and email, opening the refund's screen", async () => {
        const device = await registerAda()
        const { orderId, refundId } = await refundNeedingAccount()
        const amount = formatMoney(ORDER_TOTALS.get(GROCERY)!, "ngn")

        const [push] = await accountPushesTo(device)
        expect(push).toMatchObject({
          title: expect.stringContaining("Your refund needs your bank account"),
          body: expect.stringContaining(amount),
          data: { url: `/refund/${refundId}`, order_id: orderId, refund_id: refundId },
        })
        const [email] = await accountEmailsToAda()
        expect(email.html).toContain(amount)
        expect(email.html).toContain(`/refund/${refundId}`)

        const { refund } = (await api.get(`/store/refunds/${refundId}`, buyer.ada())).data
        expect(refund).toMatchObject({
          id: refundId,
          amount: ORDER_TOTALS.get(GROCERY),
          currency_code: "ngn",
          status: "needs-attention",
          needs_account: true,
          order: { id: orderId, display_id: expect.any(Number), shop: GROCERY.name },
          account: null,
        })
      })
    })

    describe("Ada's bank account", () => {
      const ACCOUNT = "0123456789"
      const GTB = { code: "058", name: "Guaranty Trust Bank", id: 9 }
      const resolve = (refundId: string, body: unknown, headers = buyer.ada()) =>
        api.post(`/store/refunds/${refundId}/resolve-account`, body, headers)
      const retry = (refundId: string, body: unknown, headers = buyer.ada()) => api.post(`/store/refunds/${refundId}/retry`, body, headers)
      /** Every line the API logged while `run` ran. */
      const loggedDuring = async (run: () => Promise<unknown>) => {
        const logger = getContainer().resolve("logger") as unknown as Record<string, (...args: unknown[]) => unknown>
        const spies = ["info", "warn", "error", "debug", "log", "http", "verbose", "activity", "progress", "success", "failure"]
          .filter((level) => typeof logger[level] === "function")
          .map((level) => jest.spyOn(logger, level as never))
        try {
          await run()
          return spies.flatMap((spy) => spy.mock.calls.map((args) => JSON.stringify(args)))
        } finally {
          spies.forEach((spy) => spy.mockRestore())
        }
      }

      it("is resolved to its holder's name, and the refund retried to it once she confirms, then followed by webhooks", async () => {
        const device = await registerAda()
        const { paystackRefundId, refundId, reference } = await refundNeedingAccount()

        const { banks } = (await api.get(`/store/refunds/${refundId}/banks`, buyer.ada())).data
        expect(banks).toContainEqual({ code: GTB.code, name: GTB.name })

        const logged = await loggedDuring(async () => {
          const resolved = (await resolve(refundId, { bank_code: GTB.code, account_number: ACCOUNT })).data
          expect(resolved).toEqual({ account: { bank_name: GTB.name, account_name: accountName(ACCOUNT) } })

          const { refund } = (await retry(refundId, { bank_code: GTB.code, account_number: ACCOUNT })).data
          expect(refund).toMatchObject({
            id: refundId,
            status: "processing",
            needs_account: false,
            account: { bank_name: GTB.name, last4: "6789" },
          })
        })
        expect(paystack.retries()).toContainEqual({ refund_id: paystackRefundId, currency: "NGN", account_number: ACCOUNT, bank_id: String(GTB.id) })

        // Never kept: the account number is in no log line and nowhere on the refund.
        expect(logged.join("\n")).not.toContain(ACCOUNT)
        expect(JSON.stringify(await orderRefundOf(paystackRefundId))).not.toContain(ACCOUNT)

        // Paystack's webhooks carry on from there.
        paystack.settleRefund(paystackRefundId, "processed")
        await buyer.postWebhook(paystack.refundEvent(paystackRefundId))
        await eventually(
          () => orderRefundOf(paystackRefundId),
          (r) => r?.status === "processed"
        )
        await eventually(
          async () => expo.sentTo(device).filter((m: any) => String(m.title ?? "").endsWith("completed")),
          (sent) => sent.length === 1
        )
        expect(paystack.refundsOf(reference)).toHaveLength(1)
      })

      it("can't be checked or used for another buyer's refund, or once the refund no longer needs attention", async () => {
        const { refundId, paystackRefundId } = await refundNeedingAccount()
        const body = { bank_code: GTB.code, account_number: ACCOUNT }
        const bola = buyer.as("bola@oja.test")

        expect(await statusOf(api.get(`/store/refunds/${refundId}`, bola))).toBe(404)
        expect(await statusOf(resolve(refundId, body, bola))).toBe(404)
        expect(await statusOf(retry(refundId, body, bola))).toBe(404)
        expect(paystack.retries().filter((r) => r.refund_id === paystackRefundId)).toEqual([])

        await retry(refundId, body)
        expect(await statusOf(retry(refundId, body))).toBe(409)
        expect(await statusOf(resolve(refundId, body))).toBe(409)
      })

      it("is refused, without repeating the number, when Paystack can't find it, isn't 10 digits, or isn't at a listed bank", async () => {
        const { refundId } = await refundNeedingAccount()
        const unknown = "0987654321"
        paystack.unknownAccount(unknown)

        const refused = await resolve(refundId, { bank_code: GTB.code, account_number: unknown }).catch((e) => e.response)
        expect(refused.status).toBe(400)
        expect(JSON.stringify(refused.data)).not.toContain(unknown)
        expect(await statusOf(resolve(refundId, { bank_code: GTB.code, account_number: "12345" }))).toBe(400)
        expect(await statusOf(resolve(refundId, { bank_code: "000", account_number: ACCOUNT }))).toBe(400)
        expect(await statusOf(retry(refundId, { bank_code: "000", account_number: ACCOUNT }))).toBe(400)

        paystack.limitResolves(true)
        try {
          expect(await statusOf(resolve(refundId, { bank_code: GTB.code, account_number: ACCOUNT }))).toBe(400)
        } finally {
          paystack.limitResolves(false)
        }
        const { refund } = (await api.get(`/store/refunds/${refundId}`, buyer.ada())).data
        expect(refund).toMatchObject({ status: "needs-attention", needs_account: true })
      })
    })
  },
})
