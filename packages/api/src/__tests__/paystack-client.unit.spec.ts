import { PaystackClient, PaystackRequestError } from "../modules/paystack/client"

// A buyer's bank account goes to Paystack only (#13): a request Paystack refuses is logged and
// may be reported, so its error never carries the account number.
describe("PaystackClient", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })
  const refuse = (status: number, message: string) => {
    globalThis.fetch = jest.fn(async () => Response.json({ status: false, message }, { status })) as unknown as typeof fetch
  }

  it("leaves the query, and so the account number, out of a refused lookup's error", async () => {
    refuse(422, "Could not resolve account name. Check parameters or try again.")

    const error = await new PaystackClient("sk_test").resolveAccount({ account_number: "0123456789", bank_code: "058" }).catch((e) => e)

    expect(error).toBeInstanceOf(PaystackRequestError)
    expect(error).toMatchObject({ status: 422, reason: "Could not resolve account name. Check parameters or try again." })
    expect(error.message).toBe("Paystack GET /bank/resolve failed (422): Could not resolve account name. Check parameters or try again.")
  })

  it("retries a refund with the buyer's bank account, sending Paystack the details", async () => {
    const fetch = jest.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ status: true, message: "Refund retried", data: { id: 7, status: "processing", amount: 100, currency: "NGN" } })
    )
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch

    const refund = await new PaystackClient("sk_test", "https://paystack.test").retryRefund(7, {
      currency: "NGN",
      account_number: "0123456789",
      bank_id: 9,
    })

    expect(refund).toMatchObject({ id: 7, status: "processing" })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe("https://paystack.test/refund/retry_with_customer_details/7")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({
      refund_account_details: { currency: "NGN", account_number: "0123456789", bank_id: "9" },
    })
  })
})
