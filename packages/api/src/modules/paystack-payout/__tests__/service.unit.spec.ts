import { PayoutAccountStatus, PayoutStatus } from "@mercurjs/types"
import { fakePaystack } from "../../../../integration-tests/helpers/paystack"
import { PaystackClient } from "../../paystack/client"
import { PaystackPayoutProviderService } from "../service"

const paystack = fakePaystack(49000 + (process.pid % 1000))

describe("Paystack payout provider", () => {
  beforeAll(() => paystack.start())
  afterAll(() => paystack.stop())

  const provider = () =>
    new PaystackPayoutProviderService({}, { accounts: { ngn: { secretKey: paystack.secretKey, apiUrl: paystack.apiUrl } } })

  /** A shop's transfer recipient, as onboarding makes it. */
  const recipient = async () => {
    const created = await new PaystackClient(paystack.secretKey, paystack.apiUrl).createTransferRecipient({
      type: "nuban",
      name: "Mama Put Groceries",
      account_number: "0123456789",
      bank_code: "058",
      currency: "NGN",
    })
    return created.recipient_code
  }

  const payout = async (amount: number, reference: string) =>
    provider().createPayout({
      account_id: "pacc_1",
      amount,
      currency_code: "ngn",
      data: { recipient_code: await recipient(), reference, reason: "Oja order #12", order_id: "order_12" },
    })

  it("transfers the payout to the shop's recipient in kobo, under our reference, and waits for Paystack to settle it", async () => {
    const result = await payout(4500.5, "payout_order_a")

    const [transfer] = paystack.transfers().filter((t) => t.reference === "payout_order_a")
    expect(transfer).toMatchObject({ amount: 450050, currency: "NGN", reason: "Oja order #12", status: "pending" })
    expect(result).toEqual({
      status: PayoutStatus.PENDING,
      data: expect.objectContaining({ reference: "payout_order_a", order_id: "order_12", transfer_code: transfer.transfer_code }),
    })
  })

  it("sends nothing for a payout of nothing, which is paid", async () => {
    const before = paystack.transfers().length

    const result = await payout(0, "payout_order_b")

    expect(paystack.transfers()).toHaveLength(before)
    expect(result.status).toBe(PayoutStatus.PAID)
  })

  it("fails when Paystack turns the transfer down", async () => {
    paystack.refuseTransfers("Your balance is not enough to fulfil this request")
    try {
      await expect(payout(100, "payout_order_c")).rejects.toThrow(/balance is not enough/)
    } finally {
      paystack.refuseTransfers(undefined)
    }
  })

  it("won't pay out without a recipient, or in a currency no account pays out", async () => {
    await expect(
      provider().createPayout({ account_id: "pacc_1", amount: 100, currency_code: "ngn", data: { reference: "x", reason: "y" } })
    ).rejects.toThrow(/recipient/)
    await expect(
      provider().createPayout({
        account_id: "pacc_1",
        amount: 100,
        currency_code: "ghs",
        data: { recipient_code: "RCP_1", reference: "payout_order_d", reason: "y" },
      })
    ).rejects.toThrow(/GHS/)
  })

  it("makes payout accounts active from the start: onboarding is Oja's own", async () => {
    const account = await provider().createPayoutAccount({ context: { idempotency_key: "pacc_2" }, data: { recipient_code: "RCP_evil" } })

    expect(account).toEqual({ id: "pacc_2", status: PayoutAccountStatus.ACTIVE, data: {} })
  })
})
