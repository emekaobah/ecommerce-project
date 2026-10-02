import { PaymentSessionStatus } from "@medusajs/framework/utils"
import { fakePaystack } from "../../../../integration-tests/helpers/paystack"
import { PaystackPaymentProviderService, type PaystackSessionData } from "../service"

const paystack = fakePaystack(48000 + (process.pid % 1000))

describe("Paystack provider refunds", () => {
  beforeAll(() => paystack.start())
  afterAll(() => paystack.stop())

  const provider = () =>
    new PaystackPaymentProviderService({ logger: console } as never, {
      secretKey: paystack.secretKey,
      apiUrl: paystack.apiUrl,
    })

  /** A ₦10,000 transaction the buyer paid. */
  const paidSession = async () => {
    const { data } = await provider().initiatePayment({
      amount: 10000,
      currency_code: "ngn",
      data: { email: "ada@oja.test", session_id: "payses_1" },
    })
    const session = data as PaystackSessionData
    paystack.pay(session.reference)
    return session
  }

  it("refunds part of a transaction, noting the refund it is for, and keeps Paystack's reply", async () => {
    const session = await paidSession()

    const { data } = await provider().refundPayment({
      data: session,
      amount: 4000,
      context: { idempotency_key: "ref_medusa_1" },
    })

    const [refund] = paystack.refundsOf(session.reference)
    expect(refund).toMatchObject({ amount: 400000, merchant_note: "ref_medusa_1", status: "pending" })
    expect((data as { refund?: { id: number } }).refund?.id).toBe(refund.id)
  })

  it("takes two partial refunds on one transaction", async () => {
    const session = await paidSession()

    await provider().refundPayment({ data: session, amount: 4000, context: { idempotency_key: "ref_a" } })
    await provider().refundPayment({ data: session, amount: 6000, context: { idempotency_key: "ref_b" } })

    expect(paystack.refundsOf(session.reference).map((r) => r.amount)).toEqual([400000, 600000])
  })

  it("still reads a partly refunded transaction as paid, not failed", async () => {
    const session = await paidSession()
    await provider().refundPayment({ data: session, amount: 4000, context: { idempotency_key: "ref_c" } })
    expect(paystack.transaction(session.reference).status).toBe("reversal-pending")

    expect((await provider().authorizePayment({ data: session })).status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect((await provider().getPaymentStatus({ data: session })).status).toBe(PaymentSessionStatus.AUTHORIZED)
  })
})
