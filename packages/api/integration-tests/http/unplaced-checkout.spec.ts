import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { adminHeaders } from "../helpers/auth"
import { buyerCheckout, eventually, GADGETS, GROCERY, RICE, TOTAL, type Shop } from "../helpers/checkout"
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
    /** Sets how many of a shop's product can still be sold; returns how to put the stock back. */
    const setStock = async (shop: Shop, title: string, units: number) => {
      const inventory = getContainer().resolve(Modules.INVENTORY)
      const { data: offers } = await ada.query().graph({
        entity: "offer",
        fields: ["inventory_item_link.inventory_item.location_levels.*"],
        filters: { id: await ada.offerId(shop, title) },
      })
      const [level] = (offers[0] as any).inventory_item_link[0].inventory_item.location_levels
      const update = (stocked_quantity: number) =>
        inventory.updateInventoryLevels([{ inventory_item_id: level.inventory_item_id, location_id: level.location_id, stocked_quantity }])
      await update(Number(level.reserved_quantity) + units)
      return () => update(Number(level.stocked_quantity))
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

    describe("a completion that fails once", () => {
      it("places the orders when it is tried again, and refunds nothing", async () => {
        const cartId = await preparedCart(ada)
        const { reference } = await ada.startPayment(cartId)
        paystack.pay(reference)
        // The rice is briefly out of stock as Paystack's webhook arrives, and back moments later.
        const restore = await setStock(GROCERY, RICE.title, 0)
        try {
          await ada.postWebhook(paystack.chargeSuccess(reference))
          await eventually(() => ada.paymentOf(cartId), (p) => !!p?.captured_at, 150)
          await new Promise((resolve) => setTimeout(resolve, 1500))
          expect(await ada.ordersOfCart(cartId)).toEqual([])
        } finally {
          await restore()
        }

        await ada.orderGroupOf(cartId)
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
