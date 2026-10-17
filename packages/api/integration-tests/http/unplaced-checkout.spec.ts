import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { adminHeaders } from "../helpers/auth"
import { buyerCheckout, eventually, GADGETS, GROCERY } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"
import { keepShopsOpen } from "../helpers/shop-hours"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(33000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(34000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

let codes = 0
/** A promo code no other test uses: codes are unique across the marketplace. */
const newCode = (prefix: string) => `${prefix}${++codes}`

// A buyer's Paystack payment can go through while their cart then fails to become orders (#38).
// The cart is tried once more, then refunded in full and fixed for the buyer to pay again.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const ada = buyerCheckout({ api, getContainer, clerk, paystack })
    const bola = buyerCheckout({ api, getContainer, clerk, paystack, email: "bola@oja.test" })
    let admin: { headers: Record<string, string> }

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      await Promise.all([ada.load(), bola.load()])
      admin = await adminHeaders(getContainer(), api)
    })

    /** A buyer's cart, ready to pay. */
    const preparedCart = async (buyer: typeof ada) => {
      const cartId = await buyer.adasCart()
      await buyer.prepare(cartId)
      return cartId
    }
    /** The buyer's checkout once it says the cart wasn't placed. */
    const notPlaced = async (buyer: typeof ada, cartId: string) =>
      eventually(() => buyer.checkout(cartId), (c) => !!c.not_placed, 300)

    describe("a code used up while the buyer paid", () => {
      it("refunds the second cart to pay with a code's last use in full, after trying it again, and places none of its orders", async () => {
        const code = newCode("LAST")
        await api.post(
          "/admin/promotions",
          {
            code,
            type: "standard",
            status: "active",
            is_tax_inclusive: true,
            limit: 1,
            application_method: { type: "percentage", target_type: "items", allocation: "across", value: 10 },
          },
          admin
        )
        const first = await preparedCart(ada)
        const second = await preparedCart(bola)
        await api.post(`/store/carts/${first}/checkout/promo-codes`, { code }, ada.ada())
        await api.post(`/store/carts/${second}/checkout/promo-codes`, { code }, bola.ada())
        // Both start paying before either is placed, so each was let use the code's one use.
        const firstPayment = await ada.startPayment(first)
        const secondPayment = await bola.startPayment(second)
        paystack.pay(firstPayment.reference)
        paystack.pay(secondPayment.reference)
        await ada.postWebhook(paystack.chargeSuccess(firstPayment.reference))
        await ada.orderGroupOf(first)

        await bola.postWebhook(paystack.chargeSuccess(secondPayment.reference))

        const checkout = await notPlaced(bola, second)
        const paid = paystack.transaction(secondPayment.reference).amount
        expect(paystack.refundsOf(secondPayment.reference).map((r) => r.amount)).toEqual([paid])
        expect(checkout.not_placed).toMatchObject({ reason: "code_used_up", amount: paid / 100 })
        expect(checkout.order_group_id).toBeNull()
        expect(await bola.ordersOfCart(second)).toEqual([])
        expect(paystack.refundsOf(firstPayment.reference)).toEqual([])
      })
    })
  },
})
