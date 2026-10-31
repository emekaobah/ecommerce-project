import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { seedDemoWorld } from "../../src/scripts/seed"
import { fakeClerk } from "../helpers/clerk"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// Set before the runner loads medusa-config, which registers the Clerk provider only when a key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey

const PATH = "/store/customers/me/notification-preferences"

// A buyer's notification settings (#138) are kept on the server, so they hold on any phone the
// buyer signs in on. Both cart reminder channels are on until the buyer turns one off.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let headers: Record<string, string>

    beforeAll(async () => {
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })

    beforeEach(async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: keys } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
      headers = { "x-publishable-api-key": keys[0].token }
    })

    /** A signed-in buyer's request config; a new email is a new buyer. */
    const buyer = (email: string) => ({
      headers: { ...headers, authorization: `Bearer ${clerk.sessionToken({ sub: `user_${email}`, email })}` },
    })
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )
    const preferencesOf = async (as: object) => (await api.get(PATH, as)).data.notification_preferences
    const change = async (as: object, body: object) => (await api.post(PATH, body, as)).data.notification_preferences

    it("has both cart reminders on for a buyer who hasn't changed them", async () => {
      expect(await preferencesOf(buyer("ada-defaults@oja.test"))).toEqual({ cart_reminder_push: true, cart_reminder_email: true })
    })

    it("keeps a change, leaving the other setting as it was", async () => {
      const ada = buyer("ada-changes@oja.test")

      expect(await change(ada, { cart_reminder_push: false })).toEqual({ cart_reminder_push: false, cart_reminder_email: true })
      expect(await preferencesOf(ada)).toEqual({ cart_reminder_push: false, cart_reminder_email: true })

      await change(ada, { cart_reminder_email: false })
      await change(ada, { cart_reminder_push: true })
      expect(await preferencesOf(ada)).toEqual({ cart_reminder_push: true, cart_reminder_email: false })
    })

    it("are the buyer's own: another buyer's change doesn't touch them", async () => {
      const ada = buyer("ada-own@oja.test")
      const bola = buyer("bola-own@oja.test")

      await change(bola, { cart_reminder_push: false, cart_reminder_email: false })

      expect(await preferencesOf(ada)).toEqual({ cart_reminder_push: true, cart_reminder_email: true })
      expect(await preferencesOf(bola)).toEqual({ cart_reminder_push: false, cart_reminder_email: false })
    })

    it("can't be read or changed without signing in", async () => {
      expect(await status(api.get(PATH, { headers }))).toBe(401)
      expect(await status(api.post(PATH, { cart_reminder_push: false }, { headers }))).toBe(401)
    })

    it("refuses a setting that isn't on or off", async () => {
      const ada = buyer("ada-refused@oja.test")

      expect(await status(api.post(PATH, { cart_reminder_push: "no" }, ada))).toBe(400)
      expect(await status(api.post(PATH, { orders_on_lock_screen: false }, ada))).toBe(400)
      expect(await preferencesOf(ada)).toEqual({ cart_reminder_push: true, cart_reminder_email: true })
    })
  },
})
