import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { refundUnclaimedPayments } from "../../src/lib/order-acceptance"
import { seedDemoWorld } from "../../src/scripts/seed"
import { adminHeaders } from "../helpers/auth"
import { buyerCheckout, eventually, GADGETS, GROCERY, RICE, TOTAL } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush, pushToken } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeResend } from "../helpers/resend"
import { fakeShipbubble } from "../helpers/shipbubble"
import { keepShopsOpen } from "../helpers/shop-hours"
import { formatMoney, PRODUCT_NAME } from "@oja/domain"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(33000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(34000 + (process.pid % 1000))
const expo = fakeExpoPush(35000 + (process.pid % 1000))
const resend = fakeResend(36000 + (process.pid % 1000))
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

const HOUR = 60 * 60 * 1000

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
      await Promise.all([paystack.start(), shipbubble.start(), expo.start(), resend.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop(), resend.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      expo.reset()
      resend.reset()
      await Promise.all([ada.load(), bola.load()])
      admin = await adminHeaders(getContainer(), api)
    })

    /** A buyer's cart, ready to pay. */
    const preparedCart = async (buyer: typeof ada) => {
      const cartId = await buyer.adasCart()
      await buyer.prepare(cartId)
      return cartId
    }
    const setStock = ada.setStock
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
        // Why it failed is kept with it.
        const { data } = await bola.query().graph({ entity: "cart", fields: ["metadata"], filters: { id: second } })
        expect((data[0] as any).metadata.not_placed.failure).toBe("Promotion usage exceeds the limit.")
        expect(checkout.order_group_id).toBeNull()
        expect(await bola.ordersOfCart(second)).toEqual([])
        expect(paystack.refundsOf(firstPayment.reference)).toEqual([])
      })
    })

    describe("a completion that fails once", () => {
      it("places the orders when it is tried again, and refunds nothing", async () => {
        const cartId = await preparedCart(ada)
        const { reference } = await ada.startPayment(cartId)
        paystack.pay(reference)
        // Mercur's completion of the cart fails for a moment, as the webhook arrives.
        let failed = false
        const fail = jest.spyOn(getContainer().resolve(Modules.ORDER), "createOrders").mockImplementationOnce(async () => {
          failed = true
          throw new Error("Connection terminated")
        })
        try {
          await ada.postWebhook(paystack.chargeSuccess(reference))
          await ada.orderGroupOf(cartId)
        } finally {
          fail.mockRestore()
        }

        expect(failed).toBe(true)
        expect(await ada.ordersOfCart(cartId)).toHaveLength(2)
        expect(paystack.refundsOf(reference)).toEqual([])
        expect((await ada.checkout(cartId)).not_placed).toBeNull()
      })
    })

    describe("a completion that takes a while", () => {
      it("is waited for: the orders are placed once, and nothing is refunded", async () => {
        const cartId = await preparedCart(ada)
        const { reference } = await ada.startPayment(cartId)
        paystack.pay(reference)
        // Mercur's completion of the cart is slow to create its orders.
        const orders = getContainer().resolve(Modules.ORDER)
        const createOrders = orders.createOrders.bind(orders) as (...args: unknown[]) => Promise<unknown>
        const slow = jest.spyOn(orders, "createOrders").mockImplementationOnce((async (...args: unknown[]) => {
          await new Promise((resolve) => setTimeout(resolve, 8000))
          return createOrders(...args)
        }) as any)
        try {
          await ada.postWebhook(paystack.chargeSuccess(reference))
          await ada.orderGroupOf(cartId)
          // Long enough for anything else the webhook started to have finished.
          await new Promise((resolve) => setTimeout(resolve, 10000))
        } finally {
          slow.mockRestore()
        }

        expect(await ada.ordersOfCart(cartId)).toHaveLength(2)
        expect(paystack.refundsOf(reference)).toEqual([])
        expect((await ada.checkout(cartId)).not_placed).toBeNull()
      })
    })

    describe("a charge for a different amount than the cart", () => {
      it("is refunded in full, places nothing, and the buyer can pay again", async () => {
        const cartId = await preparedCart(ada)
        const { reference } = await ada.startPayment(cartId)
        // Paystack took less than the transaction was started for: a bug or tampering.
        paystack.transaction(reference).amount = TOTAL * 100 - 500000
        paystack.pay(reference)

        await ada.postWebhook(paystack.chargeSuccess(reference))

        await eventually(async () => paystack.refundsOf(reference), (refunds) => refunds.length > 0, 150)
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([TOTAL * 100 - 500000])
        expect(await ada.ordersOfCart(cartId)).toEqual([])
        expect(await ada.startPayment(cartId)).toMatchObject({ reference: expect.any(String) })
      })
    })

    describe("an item sold out while the buyer paid", () => {
      it("refunds the cart in full, says so, and cuts the line to what is left", async () => {
        const cartId = await preparedCart(ada)
        const { reference } = await ada.startPayment(cartId)
        paystack.pay(reference)
        // Only one bag of rice is left by the time Paystack's webhook arrives; Ada has two.
        const restore = await setStock(GROCERY, RICE.title, 1)
        try {
          await ada.postWebhook(paystack.chargeSuccess(reference))

          const checkout = await notPlaced(ada, cartId)
          expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([TOTAL * 100])
          expect(checkout.not_placed).toEqual({
            reason: "sold_out",
            amount: TOTAL,
            changes: [
              {
                type: "quantity_reduced",
                product_title: RICE.title,
                variant_title: RICE.title,
                seller: GROCERY.name,
                was: 2,
                now: 1,
              },
            ],
          })
          const rice = checkout.sellers.find((g: any) => g.seller.name === GROCERY.name).items[0]
          expect(rice.quantity).toBe(1)
          expect(await ada.ordersOfCart(cartId)).toEqual([])
        } finally {
          await restore()
        }
      })

      it("is refunded once: not again by the job for payments no order claims, nor placed by the webhook sent again", async () => {
        const cartId = await preparedCart(ada)
        const { reference } = await ada.startPayment(cartId)
        paystack.pay(reference)
        const restore = await setStock(GROCERY, RICE.title, 1)
        const webhook = paystack.chargeSuccess(reference)
        try {
          await ada.postWebhook(webhook)
          await notPlaced(ada, cartId)
        } finally {
          await restore()
        }

        // Stock is back, but the payment was refunded: the cart isn't placed on it.
        await ada.postWebhook(webhook)
        await new Promise((resolve) => setTimeout(resolve, 8000))
        await refundUnclaimedPayments(getContainer(), new Date(Date.now() + HOUR))

        expect(paystack.refundsOf(reference)).toHaveLength(1)
        expect(await ada.ordersOfCart(cartId)).toEqual([])
      })

      it("tells the buyer by push and email why it wasn't placed and what was refunded", async () => {
        const device = pushToken()
        await api.post("/store/push-tokens", { token: device }, ada.ada())
        const cartId = await preparedCart(ada)
        const { reference } = await ada.startPayment(cartId)
        paystack.pay(reference)
        const restore = await setStock(GROCERY, RICE.title, 1)
        try {
          await ada.postWebhook(paystack.chargeSuccess(reference))
          await notPlaced(ada, cartId)
        } finally {
          await restore()
        }

        const refunded = `You've been refunded ${formatMoney(TOTAL, "ngn")}.`
        const [push] = await eventually(async () => expo.sentTo(device), (sent) => sent.length > 0)
        expect(push).toMatchObject({
          title: "Your order wasn't placed",
          body: `An item sold out while you paid. ${refunded}`,
          data: { url: `/checkout?cartId=${cartId}`, cart_id: cartId },
        })
        const [email] = await eventually(async () => resend.sentTo("ada@oja.test"), (sent) => sent.length > 0)
        expect(email.subject).toBe(`Your ${PRODUCT_NAME} order wasn't placed: you've been refunded`)
        expect(email.text).toContain(`An item sold out while you paid. ${refunded}`)
        expect(email.text).toContain("can take a few days to reach your card")
        expect(email.text).toContain(`${RICE.title} from ${GROCERY.name}: only 1 left, so you now have 1 (was 2).`)
      })

      it("lets the buyer pay the fixed cart's new total, and places it", async () => {
        const cartId = await preparedCart(ada)
        const { reference } = await ada.startPayment(cartId)
        paystack.pay(reference)
        const restore = await setStock(GROCERY, RICE.title, 1)
        try {
          await ada.postWebhook(paystack.chargeSuccess(reference))
          await notPlaced(ada, cartId)
        } finally {
          await restore()
        }

        // The parcel changed, so checkout quotes its delivery again.
        await ada.prepare(cartId)
        const again = await ada.startPayment(cartId)
        expect(paystack.transaction(again.reference).amount).toBe((TOTAL - RICE.price) * 100)
        // Paying again, the app waits for this payment's order, not the last one's refund.
        expect((await ada.checkout(cartId)).not_placed).toBeNull()
        paystack.pay(again.reference)
        await ada.postWebhook(paystack.chargeSuccess(again.reference))

        await ada.orderGroupOf(cartId)
        expect(await ada.ordersOfCart(cartId)).toHaveLength(2)
        expect((await ada.checkout(cartId)).not_placed).toBeNull()
        expect(paystack.refundsOf(again.reference)).toEqual([])
      })
    })
  },
})
