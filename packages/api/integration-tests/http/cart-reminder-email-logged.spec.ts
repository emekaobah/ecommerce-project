import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { remindIdleCarts } from "../../src/lib/cart-reminders"
import { seedDemoWorld } from "../../src/scripts/seed"
import { buyerCheckout, GADGETS, GROCERY, LANTERN, RICE } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { keepShopsOpen } from "../helpers/shop-hours"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// Never started: these buyers don't pay.
const paystack = fakePaystack(30000 + (process.pid % 1000))
// Set before the runner loads medusa-config. No RESEND_API_KEY: emails only go to the local provider, which logs them.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.UNSUBSCRIBE_SECRET = "cart-reminder-email-logged-spec-secret"
delete process.env.RESEND_API_KEY

const HOUR = 60 * 60 * 1000

// The cart reminder email (#139) without Resend configured is logged, not sent, like every other
// email: the local notification provider takes the email channel.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const shopper = buyerCheckout({ api, getContainer, clerk, paystack })
    let buyers = 0

    beforeAll(async () => {
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
    })
    beforeEach(() => shopper.load())

    /** A new buyer's cart with a lantern and rice, and their email address. */
    const idleCart = async () => {
      const email = `logged-${++buyers}-${process.pid}@oja.test`
      const as = shopper.as(email)
      const { data } = await api.post("/store/carts", { region_id: shopper.regionId() }, as)
      const cartId = data.cart.id as string
      for (const [shop, product] of [
        [GADGETS, LANTERN],
        [GROCERY, RICE],
      ] as const)
        await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await shopper.offerId(shop, product.title), quantity: 1 }, as)
      return { email, cartId }
    }
    /** A run of the job a day after now, when any cart made now is due, in sending hours or not: the hours span the whole day. */
    const remindNextDay = async () => {
      const env = { ...process.env }
      Object.assign(process.env, { CART_REMINDER_SEND_FROM_HOUR: "0", CART_REMINDER_SEND_UNTIL_HOUR: "24" })
      try {
        await remindIdleCarts(getContainer(), new Date(Date.now() + 24 * HOUR))
      } finally {
        for (const key of ["CART_REMINDER_SEND_FROM_HOUR", "CART_REMINDER_SEND_UNTIL_HOUR"]) {
          if (env[key] === undefined) delete process.env[key]
          else process.env[key] = env[key]
        }
      }
    }
    const emailsTo = (to: string) => getContainer().resolve(Modules.NOTIFICATION).listNotifications({ to, channel: "email" })

    it("is logged by the local provider rather than sent", async () => {
      const { email } = await idleCart()

      await remindNextDay()

      const [logged, ...more] = await emailsTo(email)
      expect(more).toEqual([])
      expect(logged).toMatchObject({ template: "cart-reminder", provider_id: "local", status: "success" })
    })

    it("isn't sent at all without a secret to sign its unsubscribe link with", async () => {
      const { email } = await idleCart()
      delete process.env.UNSUBSCRIBE_SECRET
      try {
        await remindNextDay()
      } finally {
        process.env.UNSUBSCRIBE_SECRET = "cart-reminder-email-logged-spec-secret"
      }

      expect(await emailsTo(email)).toEqual([])
    })
  },
})
