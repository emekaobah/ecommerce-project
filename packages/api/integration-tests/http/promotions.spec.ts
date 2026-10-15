import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { payOutDeliveredOrders } from "../../src/lib/pay-out-orders"
import seedDemoData from "../../src/scripts/seed"
import { adminHeaders } from "../helpers/auth"
import { buyerCheckout, GADGETS, GROCERY, LANTERN, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeExpoPush } from "../helpers/expo-push"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(42000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(41000 + (process.pid % 1000))
const expo = fakeExpoPush(40000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.EXPO_ACCESS_TOKEN = expo.accessToken
process.env.EXPO_PUSH_API_URL = expo.apiUrl

/** In kobo, as Paystack transfers it. */
const kobo = (naira: number) => Math.round(naira * 100)
/** What the shop is paid for goods: all of it, less Oja's 10%. */
const lessCommission = (goods: number) => kobo(goods) - Math.round(kobo(goods) / 10)
/** The grocery's goods in Ada's cart: two bags of rice. */
const GROCERY_GOODS = 2 * RICE.price

let codes = 0
/** A promo code no other test uses: codes are unique across the marketplace. */
const newCode = (prefix: string) => `${prefix}${++codes}`

/** 10% off, VAT included, so the discount is exactly a tenth of the shelf price. */
const tenPercentOff = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  type: "standard",
  status: "active",
  is_tax_inclusive: true,
  application_method: { type: "percentage", target_type: "items", allocation: "across", value: 10 },
  ...extra,
})

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    let admin: { headers: Record<string, string> }

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), expo.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), expo.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      await buyer.load()
      admin = await adminHeaders(getContainer(), api)
    })

    const shopPromotion = async (shop: Shop, body: Record<string, unknown>) =>
      (await api.post("/vendor/promotions", body, await buyer.owner(shop))).data.promotion
    const operatorPromotion = async (body: Record<string, unknown>) =>
      (await api.post("/admin/promotions", body, admin)).data.promotion
    const applyCode = (cartId: string, code: string) =>
      api.post(`/store/carts/${cartId}/checkout/promo-codes`, { code }, buyer.ada())
    const refusal = async (request: Promise<unknown>) => {
      const error = await request.then(
        () => null,
        (e) => e.response
      )
      return { status: error?.status, message: error?.data?.message }
    }
    /** Ada's cart, ready to pay: a lantern from the gadget hub and two bags of rice from the grocery. */
    const preparedCart = async () => {
      const cartId = await buyer.adasCart()
      await buyer.prepare(cartId)
      return cartId
    }
    const groupOf = (checkout: any, shop: Shop) => checkout.sellers.find((g: any) => g.seller.name === shop.name)
    const discountOf = (group: any) => group.items.flatMap((i: any) => i.discounts).reduce((t: number, d: any) => t + d.amount, 0)

    /** Ada pays for her prepared cart with Paystack; returns the cart's orders once it is split. */
    const pay = async (cartId: string) => {
      const { reference } = await buyer.startPayment(cartId)
      paystack.pay(reference)
      await buyer.postWebhook(paystack.chargeSuccess(reference))
      await buyer.orderGroupOf(cartId)
      await buyer.capturedWithin(cartId)
    }

    const post = async (shop: Shop, path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await buyer.owner(shop))
    const shipbubbleSays = (...args: Parameters<typeof shipbubble.webhook>) => {
      const { body, headers } = shipbubble.webhook(...args)
      return api.post("/hooks/shipbubble", body, { headers })
    }
    /** The grocery's order of the cart, taken through to delivered. */
    const deliver = async (cartId: string) => {
      const orderId = await buyer.shopOrderId(GROCERY, cartId)
      await post(GROCERY, `${orderId}/accept`)
      await post(GROCERY, `${orderId}/start-picking`)
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await buyer.owner(GROCERY))).data
      for (const line of pick_list.lines) await post(GROCERY, `${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      await post(GROCERY, `${orderId}/pack`)
      const { data } = await post(GROCERY, `${orderId}/book-label`)
      const waybill = data.fulfilment.shipment.waybill as string
      await shipbubbleSays(waybill, "confirmed")
      await post(GROCERY, `${orderId}/hand-over`)
      await shipbubbleSays(waybill, "picked_up")
      await shipbubbleSays(waybill, "completed")
      return orderId
    }
    const transferFor = (orderId: string) => paystack.transfers().find((t) => t.reference === `payout_${orderId}`.toLowerCase())
    const orderPayout = async (orderId: string) =>
      (await api.get(`/vendor/orders/${orderId}/payout`, await buyer.owner(GROCERY))).data.payout

    describe("a shop's promo code", () => {
      it("takes money off that shop's items only, and stays that way as the cart changes", async () => {
        const code = newCode("GROCER")
        await shopPromotion(GROCERY, tenPercentOff(code))
        const cartId = await preparedCart()

        const { checkout } = (await applyCode(cartId, code.toLowerCase())).data

        expect(discountOf(groupOf(checkout, GROCERY))).toBe(GROCERY_GOODS / 10)
        expect(discountOf(groupOf(checkout, GADGETS))).toBe(0)
        expect(checkout.promotions).toEqual([
          { code, automatic: false, seller: expect.objectContaining({ name: GROCERY.name }), amount: GROCERY_GOODS / 10 },
        ])
        expect(checkout.discount_total).toBe(GROCERY_GOODS / 10)
        expect(checkout.total).toBe(checkout.item_subtotal + checkout.shipping_total - GROCERY_GOODS / 10)

        // Medusa works promotions out again over the whole cart on every change; checkout keeps them per shop.
        await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await buyer.offerId(GADGETS, LANTERN.title), quantity: 1 }, buyer.ada())
        const { checkout: after } = (await buyer.prepare(cartId)).data
        expect(discountOf(groupOf(after, GADGETS))).toBe(0)
        expect(discountOf(groupOf(after, GROCERY))).toBe(GROCERY_GOODS / 10)
      })

      it("comes off the shop's payout", async () => {
        const code = newCode("GROCER")
        await shopPromotion(GROCERY, tenPercentOff(code))
        const cartId = await preparedCart()
        await applyCode(cartId, code)
        await pay(cartId)
        const orderId = await deliver(cartId)

        await payOutDeliveredOrders(getContainer())

        expect(transferFor(orderId)).toMatchObject({ amount: lessCommission(GROCERY_GOODS * 0.9) })
        expect(await orderPayout(orderId)).toMatchObject({ oja_discount: 0, amount: lessCommission(GROCERY_GOODS * 0.9) / 100 })
      })

      it("is refused, with why, for a cart with none of the shop's items", async () => {
        const code = newCode("GADGET")
        await shopPromotion(GADGETS, tenPercentOff(code))
        const { data } = await api.post("/store/carts", { region_id: buyer.regionId() }, buyer.ada())
        await api.post(`/store/carts/${data.cart.id}/line-items`, { offer_id: await buyer.offerId(GROCERY, RICE.title), quantity: 1 }, buyer.ada())

        expect(await refusal(applyCode(data.cart.id, code))).toEqual({
          status: 400,
          message: `"${code}" is ${GADGETS.name}'s code: it only takes money off their items, and none in your cart qualify.`,
        })
        expect((await buyer.checkout(data.cart.id)).promotions).toEqual([])
      })

      it("can't discount delivery: Oja charges for it and pays the courier", async () => {
        const res = await refusal(
          shopPromotion(GADGETS, {
            ...tenPercentOff(newCode("FREESHIP")),
            application_method: { type: "percentage", target_type: "shipping_methods", allocation: "across", value: 100 },
          })
        )
        expect(res.status).toBe(400)
      })
    })

    describe("the operator's promo code", () => {
      it("discounts the buyer without reducing the shop's payout: Oja funds it", async () => {
        const code = newCode("OJA")
        await operatorPromotion(tenPercentOff(code))
        const cartId = await preparedCart()

        const { checkout } = (await applyCode(cartId, code)).data
        expect(discountOf(groupOf(checkout, GROCERY))).toBe(GROCERY_GOODS / 10)
        expect(discountOf(groupOf(checkout, GADGETS))).toBe(LANTERN.price / 10)
        expect(checkout.promotions[0]).toMatchObject({ code, seller: null })

        await pay(cartId)
        const orderId = await deliver(cartId)
        await payOutDeliveredOrders(getContainer())

        expect(transferFor(orderId)).toMatchObject({ amount: lessCommission(GROCERY_GOODS) })
        expect(await orderPayout(orderId)).toMatchObject({
          oja_discount: GROCERY_GOODS / 10,
          amount: lessCommission(GROCERY_GOODS) / 100,
        })
      })

      it("comes off the shop's payout when the operator set the shop to cover it", async () => {
        const code = newCode("OJA")
        const promotion = await operatorPromotion(tenPercentOff(code))
        await api.post(`/admin/promotions/${promotion.id}/cost`, { cost_bearer: "store" }, admin)
        const cartId = await preparedCart()
        await applyCode(cartId, code)
        await pay(cartId)
        // Changing it once the order is placed doesn't change the order.
        await api.post(`/admin/promotions/${promotion.id}/cost`, { cost_bearer: "marketplace" }, admin)
        const orderId = await deliver(cartId)

        await payOutDeliveredOrders(getContainer())

        expect(transferFor(orderId)).toMatchObject({ amount: lessCommission(GROCERY_GOODS * 0.9) })
      })
    })

    describe("a code the buyer can't use", () => {
      it("says a code that doesn't exist isn't valid", async () => {
        const cartId = await preparedCart()
        expect(await refusal(applyCode(cartId, "nosuchcode"))).toEqual({
          status: 400,
          message: '"NOSUCHCODE" isn\'t a valid promo code. Check it and try again.',
        })
      })

      it("says an ended promotion has expired", async () => {
        const code = newCode("ENDED")
        await getContainer()
          .resolve(Modules.PROMOTION)
          .createPromotions({
            ...(tenPercentOff(code) as any),
            campaign: { name: code, campaign_identifier: code, starts_at: new Date("2026-01-01"), ends_at: new Date("2026-02-01") },
          })
        const cartId = await preparedCart()

        expect(await refusal(applyCode(cartId, code))).toEqual({ status: 400, message: `"${code}" has expired.` })
      })

      it("says a used-up code is used up", async () => {
        const code = newCode("ONCE")
        const promotion = await operatorPromotion(tenPercentOff(code, { limit: 1 }))
        await getContainer().resolve(Modules.PROMOTION).updatePromotions({ id: promotion.id, used: 1 } as any)
        const cartId = await preparedCart()

        expect(await refusal(applyCode(cartId, code))).toEqual({ status: 400, message: `"${code}" has been used up.` })
      })

      it("starts no payment when the cart's discount changed since the buyer saw it", async () => {
        const code = newCode("OJA")
        const promotion = await operatorPromotion(tenPercentOff(code))
        const cartId = await preparedCart()
        await applyCode(cartId, code)
        await api.post(`/admin/promotions/${promotion.id}`, { status: "inactive" }, admin)

        const { data } = await api.post(`/store/carts/${cartId}/checkout/payment`, { return_url: "https://api.oja.test/paystack/return" }, buyer.ada())

        expect(data).toMatchObject({ payment: null, discount_changed: true })
        expect(data.checkout).toMatchObject({ discount_total: 0, promotions: [] })
      })

      it("can only be entered at checkout", async () => {
        const cartId = await preparedCart()
        expect((await refusal(api.post(`/store/carts/${cartId}/promotions`, { promo_codes: ["X"] }, buyer.ada()))).status).toBe(400)
      })
    })

    it("takes a code the buyer entered off again", async () => {
      const code = newCode("OJA")
      await operatorPromotion(tenPercentOff(code))
      const cartId = await preparedCart()
      await applyCode(cartId, code)

      const { checkout } = (await api.delete(`/store/carts/${cartId}/checkout/promo-codes/${code}`, buyer.ada())).data

      expect(checkout).toMatchObject({ promotions: [], discount_total: 0 })
    })

    describe("deal badges", () => {
      const listings = async (sellerId?: string) =>
        (
          await api.get(
            `/store/listings?${new URLSearchParams({ region_id: buyer.regionId(), limit: "100", ...(sellerId ? { seller_id: sellerId } : {}) })}`,
            { headers: buyer.headers() }
          )
        ).data.listings as any[]

      it("show a shop's automatic promotion on its own listings, and on no other shop's", async () => {
        const productId = async (title: string) =>
          (await buyer.query().graph({ entity: "product", fields: ["id"], filters: { title } })).data[0].id as string
        const rice = await productId(RICE.title)
        const automatic = await shopPromotion(GROCERY, {
          ...tenPercentOff(newCode("AUTO")),
          is_automatic: true,
          application_method: {
            type: "percentage",
            target_type: "items",
            allocation: "across",
            value: 10,
            // Only the grocery's rice: a shop picks its offers.
            target_rules: [
              { attribute: "items.metadata.offer_id", operator: "in", values: [await buyer.offerId(GROCERY, RICE.title)] },
            ],
          },
        })
        const grocery = await buyer.sellerId(GROCERY)
        try {
          const all = await listings()
          const riceListing = all.find((l) => l.seller.id === grocery && l.product.id === rice)
          expect(riceListing.deals).toEqual([
            { promotion_id: automatic.id, type: "percentage", value: 10, allocation: "across", currency_code: "ngn" },
          ])
          // The grocery's other products aren't in the deal; other shops never show the grocery's.
          expect(all.filter((l) => l !== riceListing).every((l) => l.deals.length === 0)).toBe(true)

          const { data } = await api.get(`/store/listings/${grocery}/${rice}?region_id=${buyer.regionId()}`, {
            headers: buyer.headers(),
          })
          expect(data.listing.deals).toHaveLength(1)
        } finally {
          await api.post(`/vendor/promotions/${automatic.id}`, { status: "inactive" }, await buyer.owner(GROCERY))
        }
        expect((await listings(grocery)).every((l) => l.deals.length === 0)).toBe(true)
      })
    })
  },
})
