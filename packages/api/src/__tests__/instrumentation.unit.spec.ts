import * as Sentry from "@sentry/node"
import { register } from "../../instrumentation"

jest.mock("@sentry/node", () => ({
  init: jest.fn(),
  httpIntegration: jest.fn((options: unknown) => ({ name: "Http", options })),
}))

// A bank account number goes to Paystack only (#13): Sentry is set up to send neither the bodies
// of the requests that carry one nor the number anywhere else in an event.
describe("register", () => {
  const init = Sentry.init as jest.Mock
  const httpIntegration = Sentry.httpIntegration as jest.Mock
  const dsn = process.env.SENTRY_DSN

  beforeEach(() => {
    init.mockClear()
    httpIntegration.mockClear()
    process.env.SENTRY_DSN = "https://public@sentry.example/1"
  })
  afterAll(() => {
    if (dsn === undefined) delete process.env.SENTRY_DSN
    else process.env.SENTRY_DSN = dsn
  })

  it("sets Sentry up only when a DSN is set", () => {
    delete process.env.SENTRY_DSN
    register()
    expect(init).not.toHaveBeenCalled()
  })

  it("attaches no body of a request carrying a bank account, and attaches the others", () => {
    register()

    const [{ ignoreRequestBody }] = httpIntegration.mock.calls[0]
    expect(ignoreRequestBody("https://api.oja.test/store/refunds/ordref_1/resolve-account")).toBe(true)
    expect(ignoreRequestBody("/store/refunds/ordref_1/retry")).toBe(true)
    expect(ignoreRequestBody("/vendor/onboarding/bank-account")).toBe(true)
    expect(ignoreRequestBody("/store/carts/cart_1/checkout")).toBe(false)
    expect(init.mock.calls[0][0].integrations).toEqual([{ name: "Http", options: { ignoreRequestBody } }])
  })

  it("blanks an account number in every event, span and breadcrumb it sends", () => {
    register()

    const { beforeSend, beforeSendSpan, beforeBreadcrumb } = init.mock.calls[0][0]
    const lookup = "https://api.paystack.co/bank/resolve?account_number=0123456789&bank_code=058"
    const blanked = "https://api.paystack.co/bank/resolve?account_number=[redacted]&bank_code=058"
    expect(beforeSend({ request: { url: lookup } })).toEqual({ request: { url: blanked } })
    expect(beforeSendSpan({ description: `GET ${lookup}` })).toEqual({ description: `GET ${blanked}` })
    expect(beforeBreadcrumb({ data: { url: lookup } })).toEqual({ data: { url: blanked } })
  })
})
