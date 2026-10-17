import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { adminHeaders } from "../helpers/auth"
import { buyerCheckout, eventually, GADGETS, GROCERY, LANTERN, RICE, TOTAL, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { BEST_VALUE_FEE, fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so the fake can be named in the config before it is listening.
const paystack = fakePaystack(38000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(39000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

/** The grocery's share of Ada's cart: two bags of rice, delivered at the best-value rate. */
const GROCERY_TOTAL = 2 * RICE.price + BEST_VALUE_FEE
const GADGETS_TOTAL = LANTERN.price + BEST_VALUE_FEE

// Mercur's default order-group fields nest deeper than the store's relation limit (3).
const ORDER_GROUP_FIELDS = ["id", "seller_count", "total", "orders.total", "orders.seller.name", "orders.items.quantity"].join(",")

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(() => buyer.load())

    /** "Pay for this shop only": the shop's items move to a cart of their own, returned by shop. */
    const payShopOnly = async (cartId: string, shop: Shop) =>
      (await api.post(`/store/carts/${cartId}/shop-checkout`, { seller_id: await buyer.sellerId(shop) }, buyer.ada())).data
        .cart
    const cartBySeller = async (cartId: string) => (await api.get(`/store/carts/${cartId}/sellers`, buyer.ada())).data.cart
    const lines = (cart: any) =>
      cart.sellers.map((g: any) => [g.seller.name, g.items.map((i: any) => [i.product_title, i.quantity, i.unit_price])])
    /** Ada pays for a prepared cart with Paystack; returns the transaction once the webhook has been sent. */
    const pay = async (cartId: string) => {
      const payment = await buyer.startPayment(cartId)
      paystack.pay(payment.reference)
      await buyer.postWebhook(paystack.chargeSuccess(payment.reference))
      return payment.reference as string
    }
    const orderGroup = async (cartId: string) => {
      const id = await buyer.orderGroupOf(cartId)
      return (await api.get(`/store/order-groups/${id}?fields=${ORDER_GROUP_FIELDS}`, buyer.ada())).data.order_group
    }

    describe("paying for one shop's items on their own", () => {
      it("places one order group with one order for that shop, paid by its own transaction; the cart keeps the rest", async () => {
        const cartId = await buyer.adasCart()

        const shopCart = await payShopOnly(cartId, GROCERY)

        expect(shopCart.id).not.toBe(cartId)
        expect(lines(shopCart)).toEqual([[GROCERY.name, [[RICE.title, 2, RICE.price]]]])
        expect(lines(await cartBySeller(cartId))).toEqual([[GADGETS.name, [[LANTERN.title, 1, LANTERN.price]]]])

        await buyer.prepare(shopCart.id)
        const reference = await pay(shopCart.id)

        const group = await orderGroup(shopCart.id)
        expect(group).toMatchObject({ seller_count: 1, total: GROCERY_TOTAL })
        expect(group.orders.map((o: any) => [o.seller.name, o.total])).toEqual([[GROCERY.name, GROCERY_TOTAL]])
        expect(paystack.transaction(reference)).toMatchObject({ amount: GROCERY_TOTAL * 100, status: "success" })
        expect(await buyer.ordersOfCart(cartId)).toEqual([])
        expect(lines(await cartBySeller(cartId))).toEqual([[GADGETS.name, [[LANTERN.title, 1, LANTERN.price]]]])
      })

      it("leaves the rest of the cart to check out normally afterwards", async () => {
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        const shopCart = await payShopOnly(cartId, GROCERY)
        // The moved shop's delivery leaves with its items.
        expect(await buyer.checkout(cartId)).toMatchObject({ shipping_total: BEST_VALUE_FEE, total: GADGETS_TOTAL })
        await buyer.prepare(shopCart.id)
        await pay(shopCart.id)
        await buyer.orderGroupOf(shopCart.id)

        const { data } = await buyer.prepare(cartId)
        expect(data.checkout).toMatchObject({ total: GADGETS_TOTAL, ready_to_pay: true })
        const reference = await pay(cartId)

        const group = await orderGroup(cartId)
        expect(group.orders.map((o: any) => [o.seller.name, o.total])).toEqual([[GADGETS.name, GADGETS_TOTAL]])
        expect(paystack.transaction(reference)).toMatchObject({ amount: GADGETS_TOTAL * 100 })
      })

      it("is only for the signed-in buyer's own cart, and a shop with items in it beside others", async () => {
        const cartId = await buyer.adasCart()
        const grocery = await buyer.sellerId(GROCERY)
        const move = (id: string, sellerId: string, as = buyer.ada()) =>
          status(api.post(`/store/carts/${id}/shop-checkout`, { seller_id: sellerId }, as))

        expect(await move(cartId, grocery, { headers: buyer.headers() })).toBe(401)
        expect(await move(cartId, grocery, buyer.as("eve@oja.test"))).toBe(404)
        expect(lines(await cartBySeller(cartId))).toHaveLength(2)

        const shopCart = await payShopOnly(cartId, GROCERY)
        // Each cart now holds one shop: there is nothing to move out of either.
        expect(await move(cartId, grocery)).toBe(400)
        expect(await move(shopCart.id, grocery)).toBe(400)
      })
    })

    describe("a Paystack page opened for the whole cart before a shop's items moved out", () => {
      it("places no order when it is paid, and refunds it in full, as a replaced page is", async () => {
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        const old = await buyer.startPayment(cartId)

        const shopCart = await payShopOnly(cartId, GROCERY)
        paystack.pay(old.reference)
        await buyer.postWebhook(paystack.chargeSuccess(old.reference))

        await eventually(() => Promise.resolve(paystack.refundsOf(old.reference)), (refunds) => refunds.length > 0, 150)
        expect(paystack.refundsOf(old.reference).map((r) => r.amount)).toEqual([TOTAL * 100])
        expect(await buyer.ordersOfCart(cartId)).toEqual([])
        expect(await buyer.ordersOfCart(shopCart.id)).toEqual([])

        // Both carts still check out, each with a payment of its own.
        await buyer.prepare(shopCart.id)
        await pay(shopCart.id)
        expect((await orderGroup(shopCart.id)).total).toBe(GROCERY_TOTAL)
        await buyer.prepare(cartId)
        await pay(cartId)
        expect((await orderGroup(cartId)).total).toBe(GADGETS_TOTAL)
      })

      it("won't move a shop's items once the cart's payment went through: its order is on the way", async () => {
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        const { reference } = await buyer.startPayment(cartId)
        paystack.pay(reference)

        const refused = await api
          .post(`/store/carts/${cartId}/shop-checkout`, { seller_id: await buyer.sellerId(GROCERY) }, buyer.ada())
          .catch((e: any) => e.response)

        expect(refused.status).toBe(409)
        expect(lines(await cartBySeller(cartId))).toHaveLength(2)
      })
    })

    // Discounts follow items (ADR 0010).
    describe("discounts on the cart", () => {
      let admin: { headers: Record<string, string> }
      beforeEach(async () => {
        admin = await adminHeaders(getContainer(), api)
      })
      let codes = 0
      /** A promo code no other test uses: codes are unique across the marketplace. */
      const newCode = (prefix: string) => `${prefix}${++codes}`
      /** 10% off; its uses are counted only with a usage limit set. */
      const percentOff = (code: string) => ({
        code,
        type: "standard",
        status: "active",
        limit: 10,
        is_tax_inclusive: true,
        application_method: { type: "percentage", target_type: "items", allocation: "across", value: 10 },
      })
      const amountOff = (code: string, value: number) => ({
        code,
        type: "standard",
        status: "active",
        is_tax_inclusive: true,
        application_method: { type: "fixed", target_type: "items", allocation: "across", value, currency_code: "ngn" },
      })
      const shopPromotion = async (shop: Shop, body: Record<string, unknown>) =>
        (await api.post("/vendor/promotions", body, await buyer.owner(shop))).data.promotion
      const operatorPromotion = async (body: Record<string, unknown>) =>
        (await api.post("/admin/promotions", body, admin)).data.promotion
      const applyCode = (cartId: string, code: string) =>
        api.post(`/store/carts/${cartId}/checkout/promo-codes`, { code }, buyer.ada())
      const promotionsOf = async (cartId: string) =>
        (await buyer.checkout(cartId)).promotions.map((p: any) => [p.code, p.amount])
      const usesOf = async (promotionId: string) =>
        Number((await getContainer().resolve(Modules.PROMOTION).retrievePromotion(promotionId)).used ?? 0)
      /** Ada's cart, with each cart's code applied, split: the grocery's items in a cart of their own. */
      const splitWith = async (code: string) => {
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        await applyCode(cartId, code)
        const shopCart = await payShopOnly(cartId, GROCERY)
        return { cartId, shopCartId: shopCart.id as string }
      }
      const payFor = async (cartId: string) => {
        await buyer.prepare(cartId)
        await pay(cartId)
        return orderGroup(cartId)
      }

      it("moves a shop's own code with its items, and counts its use once, when that cart is paid", async () => {
        const code = newCode("GROCER")
        const promotion = await shopPromotion(GROCERY, percentOff(code))

        const { cartId, shopCartId } = await splitWith(code)

        expect(await promotionsOf(shopCartId)).toEqual([[code, (2 * RICE.price) / 10]])
        expect(await promotionsOf(cartId)).toEqual([])
        expect(await usesOf(promotion.id)).toBe(0)

        expect((await payFor(shopCartId)).total).toBe(GROCERY_TOTAL - (2 * RICE.price) / 10)
        expect(await usesOf(promotion.id)).toBe(1)
        expect((await payFor(cartId)).total).toBe(GADGETS_TOTAL)
        expect(await usesOf(promotion.id)).toBe(1)
      })

      it("keeps an operator's percentage code on both carts, each on its own items, counting a use per payment", async () => {
        const code = newCode("OJA")
        const promotion = await operatorPromotion(percentOff(code))

        const { cartId, shopCartId } = await splitWith(code)

        expect(await promotionsOf(shopCartId)).toEqual([[code, (2 * RICE.price) / 10]])
        expect(await promotionsOf(cartId)).toEqual([[code, LANTERN.price / 10]])
        expect((await payFor(shopCartId)).total).toBe(GROCERY_TOTAL - (2 * RICE.price) / 10)
        expect((await payFor(cartId)).total).toBe(GADGETS_TOTAL - LANTERN.price / 10)
        expect(await usesOf(promotion.id)).toBe(2)
      })

      it("leaves an operator's fixed amount off the whole cart with the rest, so it is taken off once", async () => {
        const code = newCode("OJAFIXED")
        await operatorPromotion(amountOff(code, 1000))

        const { cartId, shopCartId } = await splitWith(code)

        expect(await promotionsOf(shopCartId)).toEqual([])
        expect(await promotionsOf(cartId)).toEqual([[code, 1000]])
        expect((await payFor(shopCartId)).total).toBe(GROCERY_TOTAL)
        expect((await payFor(cartId)).total).toBe(GADGETS_TOTAL - 1000)
      })
    })
  },
})
