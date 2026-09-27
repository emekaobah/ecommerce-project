import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { fakeClerk } from "../helpers/clerk"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// Set before the runner loads medusa-config, which registers the Clerk provider only when a key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let publishableKey: string

    beforeEach(async () => {
      const salesChannels = getContainer().resolve(Modules.SALES_CHANNEL)
      const apiKeys = getContainer().resolve(Modules.API_KEY)
      const link = getContainer().resolve(ContainerRegistrationKeys.LINK)
      const channel = await salesChannels.createSalesChannels({ name: "Buyer app" })
      const key = await apiKeys.createApiKeys({ title: "Buyer app", type: "publishable", created_by: "test" })
      await link.create({
        [Modules.API_KEY]: { publishable_key_id: key.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id },
      })
      publishableKey = key.token
    })

    const asBuyer = (token?: string) => ({
      headers: {
        "x-publishable-api-key": publishableKey,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    })

    const customersWithEmail = async (email: string) => {
      const customers = getContainer().resolve(Modules.CUSTOMER)
      return customers.listCustomers({ email })
    }

    describe("Clerk customer auth", () => {
      it("authenticates a store request carrying a valid Clerk session token as that customer", async () => {
        const token = clerk.sessionToken({ email: "ada@oja.test", first_name: "Ada", last_name: "Obi" })

        const { status, data } = await api.get("/store/customers/me", asBuyer(token))

        expect(status).toBe(200)
        expect(data.customer).toMatchObject({ email: "ada@oja.test", first_name: "Ada", last_name: "Obi" })
      })

      it("creates the customer on first sign-in and reuses it afterwards", async () => {
        const sub = "user_first_sign_in"
        expect(await customersWithEmail("new@oja.test")).toHaveLength(0)

        const first = await api.get("/store/customers/me", asBuyer(clerk.sessionToken({ sub, email: "new@oja.test" })))
        // A fresh token for the same Clerk user, as the app sends after Clerk refreshes it.
        const second = await api.get("/store/customers/me", asBuyer(clerk.sessionToken({ sub, email: "new@oja.test" })))

        expect(second.data.customer.id).toBe(first.data.customer.id)
        const customers = await customersWithEmail("new@oja.test")
        expect(customers).toHaveLength(1)
        expect(customers[0].has_account).toBe(true)
      })

      it("maps the Clerk user id, not the email, to the customer", async () => {
        const token = clerk.sessionToken({ sub: "user_same_person", email: "old@oja.test" })
        const first = await api.get("/store/customers/me", asBuyer(token))

        const changedEmail = clerk.sessionToken({ sub: "user_same_person", email: "renamed@oja.test" })
        const second = await api.get("/store/customers/me", asBuyer(changedEmail))

        expect(second.data.customer.id).toBe(first.data.customer.id)
      })

      it("explains a missing email claim instead of creating a customer without one", async () => {
        const res = await api.get("/store/customers/me", asBuyer(clerk.sessionToken())).catch((e) => e.response)

        expect(res.status).toBe(401)
        expect(res.data.message).toMatch(/email claim/)
      })

      it("creates one customer when a new buyer's first requests arrive together", async () => {
        const sub = "user_parallel"
        const responses = await Promise.all(
          [1, 2, 3].map(() => api.get("/store/customers/me", asBuyer(clerk.sessionToken({ sub, email: "fast@oja.test" }))))
        )

        expect(new Set(responses.map((r) => r.data.customer.id)).size).toBe(1)
        expect(await customersWithEmail("fast@oja.test")).toHaveLength(1)
      })

      it.each([
        ["signed by another key", clerk.sessionToken({}, { signedBy: "stranger" })],
        ["expired", clerk.sessionToken({}, { expiresInSeconds: -120 })],
        ["for a session with pending tasks", clerk.sessionToken({ sts: "pending" })],
        ["malformed", "not-a-jwt"],
      ])("rejects a token %s, even on a route guests may use", async (_, token) => {
        const customerRoute = await api.get("/store/customers/me", asBuyer(token)).catch((e) => e.response)
        const guestRoute = await api.get("/store/regions", asBuyer(token)).catch((e) => e.response)

        expect(customerRoute.status).toBe(401)
        expect(guestRoute.status).toBe(401)
      })

      it("keeps guest browsing open without a token", async () => {
        const { status } = await api.get("/store/regions", asBuyer())
        expect(status).toBe(200)

        const me = await api.get("/store/customers/me", asBuyer()).catch((e) => e.response)
        expect(me.status).toBe(401)
      })

      it("disables customer email/password login and registration", async () => {
        const credentials = { email: "pw@oja.test", password: "supersecret" }

        const register = await api.post("/auth/customer/emailpass/register", credentials).catch((e) => e.response)
        const login = await api.post("/auth/customer/emailpass", credentials).catch((e) => e.response)

        expect(register.status).toBeGreaterThanOrEqual(400)
        expect(login.status).toBeGreaterThanOrEqual(400)
        expect(register.data.token).toBeUndefined()
        expect(login.data.token).toBeUndefined()
      })

      it("never trades a Clerk token for a long-lived Medusa customer token", async () => {
        const token = clerk.sessionToken({ email: "swap@oja.test" })

        const viaHeader = await api
          .post("/auth/customer/clerk", {}, { headers: { authorization: `Bearer ${token}` } })
          .catch((e) => e.response)
        const viaBody = await api.post("/auth/customer/clerk", { token }).catch((e) => e.response)

        for (const res of [viaHeader, viaBody]) {
          expect(res.status).toBeGreaterThanOrEqual(400)
          expect(res.data.token).toBeUndefined()
        }
      })

      it("refuses a new Clerk user whose email already has a customer account", async () => {
        await api.get("/store/customers/me", asBuyer(clerk.sessionToken({ sub: "user_original", email: "taken@oja.test" })))

        const res = await api
          .get("/store/customers/me", asBuyer(clerk.sessionToken({ sub: "user_newcomer", email: "taken@oja.test" })))
          .catch((e) => e.response)

        expect(res.status).toBe(409)
        expect(res.data.message).toMatch(/already has an account/)
      })

      it("leaves seller member email/password login working", async () => {
        const credentials = { email: "member@oja.test", password: "supersecret" }
        const register = await api.post("/auth/member/emailpass/register", credentials)
        expect(register.data.token).toBeTruthy()
      })
    })
  },
})
