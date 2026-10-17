import { carriesBankAccount, redactAccountNumbers } from "../lib/bank-account-redaction"

// A buyer's bank account goes to Paystack only (#13): Sentry is sent neither the bodies of the
// requests that carry one nor the account number in Paystack's lookup URL.
describe("redactAccountNumbers", () => {
  it("blanks the account number in a query string or JSON, whatever is around it", () => {
    expect(redactAccountNumbers("https://api.paystack.co/bank/resolve?account_number=0123456789&bank_code=058")).toBe(
      "https://api.paystack.co/bank/resolve?account_number=[redacted]&bank_code=058"
    )
    expect(redactAccountNumbers(`{"bank_code":"058","account_number":"0123456789"}`)).toBe(`{"bank_code":"058","account_number":"[redacted]"}`)
    expect(redactAccountNumbers(`{"account_number": "0123456789"}`)).toBe(`{"account_number": "[redacted]"}`)
  })

  it("redacts every string in an object, leaving the rest", () => {
    expect(
      redactAccountNumbers({ url: "/bank/resolve?account_number=0123456789", status: 422, nested: { body: `"account_number":"0123456789"` } })
    ).toEqual({ url: "/bank/resolve?account_number=[redacted]", status: 422, nested: { body: `"account_number":"[redacted]"` } })
  })

  it("leaves anything but plain objects and arrays as it is, and copes with cycles", () => {
    const at = new Date()
    const event: Record<string, unknown> = { at, message: "account_number=0123456789" }
    event.self = event

    const redacted = redactAccountNumbers(event)

    expect(redacted.at).toBe(at)
    expect(redacted.message).toBe("account_number=[redacted]")
    expect(redacted.self).toBe(redacted)
  })
})

describe("carriesBankAccount", () => {
  it("is each buyer request that sends a bank account", () => {
    expect(carriesBankAccount("https://api.oja.test/store/refunds/ordref_1/resolve-account")).toBe(true)
    expect(carriesBankAccount("/store/refunds/ordref_1/retry")).toBe(true)
    expect(carriesBankAccount("/vendor/onboarding/bank-account")).toBe(true)
    expect(carriesBankAccount("/store/refunds/ordref_1")).toBe(false)
    expect(carriesBankAccount("/store/carts/cart_1/checkout")).toBe(false)
  })
})
