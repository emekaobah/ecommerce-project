import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateOffersWorkflow } from "@mercurjs/core/workflows"
import seedDemoData from "../../src/scripts/seed"
import { SEED_DELIVERY_FEE, SEED_PASSWORD, SEED_PRODUCTS, SEED_SELLERS } from "../../src/scripts/seed-data"
import { vendorHeaders } from "../helpers/auth"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"

jest.setTimeout(5 * 60 * 1000)

const LANTERN = SEED_PRODUCTS.find((p) => p.title === "Rechargeable LED Lantern")!
const RICE = SEED_PRODUCTS.find((p) => p.title === "Ofada Rice 5kg")!
const [GROCERY, , GADGETS] = SEED_SELLERS

const clerk = fakeClerk()
// A port per test process, so the fake can be named in the config before it is listening.
const paystack = fakePaystack(47000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl

// Mercur's default order-group fields nest deeper than the store's relation limit (3).
const ORDER_GROUP_FIELDS = [
  "id",
  "seller_count",
  "total",
  "orders.id",
  "orders.total",
  "orders.seller.name",
  "orders.items.product_title",
  "orders.items.quantity",
  "orders.items.unit_price",
].join(",")
const RETURN_URL = "oja-buyer://checkout/paid"
const ADDRESS = {
  first_name: "Ada",
  last_name: "Obi",
  address_1: "3 Akin Adesola Street",
  address_2: "Flat 4",
  city: "Eti-Osa",
  province: "Lagos",
  country_code: "ng",
  phone: "+2348031234567",
  metadata: { landmark: "Opposite the Mobil station" },
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let headers: Record<string, string>
    let regionId: string

    beforeAll(async () => {
      await paystack.start()
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => paystack.stop())

    beforeEach(async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: keys } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
      headers = { "x-publishable-api-key": keys[0].token }
      const { data: regions } = await query.graph({ entity: "region", fields: ["id"] })
      regionId = regions[0].id
    })

    const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)
    const as = (email: string) => ({
      headers: { ...headers, authorization: `Bearer ${clerk.sessionToken({ sub: `user_${email}`, email })}` },
    })
    const ada = () => as("ada@oja.test")
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    const sellerId = async (shop: (typeof SEED_SELLERS)[number]) => {
      const { data } = await query().graph({ entity: "seller", fields: ["id"], filters: { name: shop.name } })
      return data[0].id as string
    }
    const offerId = async (shop: (typeof SEED_SELLERS)[number], title: string) => {
      const { data: products } = await query().graph({ entity: "product", fields: ["id"], filters: { title } })
      const { data } = await query().graph({
        entity: "offer",
        fields: ["id"],
        filters: { seller_id: await sellerId(shop), product_id: products[0].id },
      })
      return data[0].id as string
    }

    /** Ada's cart: a lantern from the gadget hub, two bags of rice from the grocery shop. */
    const adasCart = async () => {
      const { data } = await api.post("/store/carts", { region_id: regionId }, ada())
      const cartId = data.cart.id as string
      await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GADGETS, LANTERN.title), quantity: 1 }, ada())
      await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, RICE.title), quantity: 2 }, ada())
      return cartId
    }
    const TOTAL = LANTERN.price + 2 * RICE.price + 2 * SEED_DELIVERY_FEE

    const prepare = (cartId: string) => api.post(`/store/carts/${cartId}/checkout`, { shipping_address: ADDRESS }, ada())
    const startPayment = async (cartId: string) =>
      (await api.post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())).data.payment
    const checkout = async (cartId: string) => (await api.get(`/store/carts/${cartId}/checkout`, ada())).data.checkout
    const postWebhook = ({ body, headers }: { body: string; headers: Record<string, string> }) =>
      api.post("/hooks/payment/paystack_paystack", body, { headers })

    /** The cart's order group once the webhook's subscriber has completed it. */
    const orderGroupOf = async (cartId: string) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const { order_group_id } = await checkout(cartId)
        if (order_group_id) return order_group_id as string
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error(`cart ${cartId} was never completed`)
    }
    const paymentOf = async (cartId: string) => {
      const { data } = await query().graph({
        entity: "cart",
        fields: ["payment_collection.payments.captured_at", "payment_collection.payments.captures.amount"],
        filters: { id: cartId },
      })
      return (data[0].payment_collection?.payments?.[0] ?? null) as any
    }
    const capturedWithin = async (cartId: string) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const payment = await paymentOf(cartId)
        if (payment?.captured_at) return payment
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return paymentOf(cartId)
    }
    const ordersOfCart = async (cartId: string) => {
      const { data } = await query().graph({ entity: "order_cart", fields: ["order_id"], filters: { cart_id: cartId } })
      return data
    }

    describe("preparing checkout", () => {
      it("sets the delivery address and each shop's flat delivery, and totals the cart", async () => {
        const cartId = await adasCart()

        const { data } = await prepare(cartId)

        expect(data.checkout).toMatchObject({
          cart_id: cartId,
          currency_code: "ngn",
          email: "ada@oja.test",
          shipping_address: { address_1: ADDRESS.address_1, city: "Eti-Osa", metadata: { landmark: ADDRESS.metadata.landmark } },
          item_subtotal: LANTERN.price + 2 * RICE.price,
          shipping_total: 2 * SEED_DELIVERY_FEE,
          total: TOTAL,
          order_group_id: null,
        })
        expect(
          data.checkout.sellers.map((g: any) => [g.seller.name, g.item_subtotal, g.shipping?.amount])
        ).toEqual([
          [GADGETS.name, LANTERN.price, SEED_DELIVERY_FEE],
          [GROCERY.name, 2 * RICE.price, SEED_DELIVERY_FEE],
        ])
      })

      it("keeps one delivery per shop when the buyer changes the address", async () => {
        const cartId = await adasCart()
        await prepare(cartId)

        const { data } = await api.post(
          `/store/carts/${cartId}/checkout`,
          { shipping_address: { ...ADDRESS, address_1: "9 Bode Thomas Street", city: "Surulere" } },
          ada()
        )

        expect(data.checkout.shipping_address).toMatchObject({ address_1: "9 Bode Thomas Street", city: "Surulere" })
        expect(data.checkout.shipping_total).toBe(2 * SEED_DELIVERY_FEE)
        expect(data.checkout.total).toBe(TOTAL)
      })

      it("reprices every line at its shop's current price", async () => {
        const cartId = await adasCart()
        const lantern = await offerId(GADGETS, LANTERN.title)
        await updateOffersWorkflow(getContainer()).run({
          input: { offers: [{ id: lantern, prices: [{ amount: LANTERN.price + 1000, currency_code: "ngn" }] }] },
        })

        const { data } = await prepare(cartId)

        expect(data.checkout.sellers[0].items.map((i: any) => i.unit_price)).toEqual([LANTERN.price + 1000])
        expect(data.checkout.total).toBe(TOTAL + 1000)
      })

      it("asks for the address fields a delivery needs", async () => {
        const cartId = await adasCart()
        const { address_1, ...incomplete } = ADDRESS

        const res = await api
          .post(`/store/carts/${cartId}/checkout`, { shipping_address: incomplete }, ada())
          .catch((e) => e.response)

        expect(res.status).toBe(400)
      })

      it("needs the signed-in buyer who owns the cart", async () => {
        const cartId = await adasCart()

        expect(
          await Promise.all([
            status(api.post(`/store/carts/${cartId}/checkout`, { shipping_address: ADDRESS }, { headers })),
            status(api.post(`/store/carts/${cartId}/checkout`, { shipping_address: ADDRESS }, as("bola@oja.test"))),
            status(api.get(`/store/carts/${cartId}/checkout`, as("bola@oja.test"))),
          ])
        ).toEqual([401, 404, 404])
      })
    })

    describe("paying with Paystack", () => {
      it("starts a Paystack transaction for the cart's total, returning to the app", async () => {
        const cartId = await adasCart()
        await prepare(cartId)

        const payment = await startPayment(cartId)

        expect(payment.authorization_url).toBe(`https://checkout.paystack.test/${payment.reference}`)
        expect(paystack.transaction(payment.reference)).toMatchObject({
          // Paystack charges in kobo.
          amount: TOTAL * 100,
          currency: "NGN",
          email: "ada@oja.test",
          callback_url: RETURN_URL,
        })
      })

      it("won't start a payment before the address and delivery are set", async () => {
        const cartId = await adasCart()

        const res = await api
          .post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())
          .catch((e) => e.response)

        expect(res.status).toBe(400)
      })

      it("splits a paid cart into one order group with an order per shop, once Paystack's webhook confirms it", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        const { reference } = await startPayment(cartId)
        paystack.pay(reference)

        expect((await postWebhook(paystack.chargeSuccess(reference))).status).toBe(200)

        const orderGroupId = await orderGroupOf(cartId)
        const { data: group } = await api.get(`/store/order-groups/${orderGroupId}?fields=${ORDER_GROUP_FIELDS}`, ada())
        expect(group.order_group).toMatchObject({ id: orderGroupId, seller_count: 2, total: TOTAL })
        const orders = group.order_group.orders
          .map((o: any) => ({
            shop: o.seller.name,
            items: o.items.map((i: any) => [i.product_title, i.quantity, i.unit_price]),
            total: o.total,
          }))
          .sort((a: any, b: any) => a.shop.localeCompare(b.shop))
        expect(orders).toEqual([
          { shop: GADGETS.name, items: [[LANTERN.title, 1, LANTERN.price]], total: LANTERN.price + SEED_DELIVERY_FEE },
          { shop: GROCERY.name, items: [[RICE.title, 2, RICE.price]], total: 2 * RICE.price + SEED_DELIVERY_FEE },
        ])
        // No stray single order besides the split ones.
        expect(await ordersOfCart(cartId)).toHaveLength(2)
        const payment = await capturedWithin(cartId)
        expect(payment.captures.map((c: any) => c.amount)).toEqual([TOTAL])
      })

      it("shows each shop its own order in the vendor order list", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        const { reference } = await startPayment(cartId)
        paystack.pay(reference)
        await postWebhook(paystack.chargeSuccess(reference))
        await orderGroupOf(cartId)

        for (const [shop, title] of [
          [GADGETS, LANTERN.title],
          [GROCERY, RICE.title],
        ] as const) {
          const owner = await vendorHeaders(api, shop.staff.email, SEED_PASSWORD, await sellerId(shop))
          const { data } = await api.get("/vendor/orders", owner)
          expect(data.orders.map((o: any) => o.items.map((i: any) => i.product_title))).toEqual([[title]])
        }
      })

      it("rejects a webhook with a bad signature and captures nothing", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        const { reference } = await startPayment(cartId)
        paystack.pay(reference)

        const forged = paystack.chargeSuccess(reference, { signedWith: "sk_test_not_ours" })
        const res = await postWebhook(forged).catch((e) => e.response)

        expect(res.status).toBe(401)
        expect((await checkout(cartId)).order_group_id).toBeNull()
        expect(await paymentOf(cartId)).toBeNull()
      })

      it("captures only after the webhook, even when the cart is completed first", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        const { reference } = await startPayment(cartId)
        paystack.pay(reference)

        const { data } = await api.post(`/store/carts/${cartId}/complete`, {}, ada())

        expect(data.type).toBe("order_group")
        expect((await paymentOf(cartId)).captured_at).toBeNull()

        await postWebhook(paystack.chargeSuccess(reference))

        expect((await capturedWithin(cartId)).captures.map((c: any) => c.amount)).toEqual([TOTAL])
        expect(await ordersOfCart(cartId)).toHaveLength(2)
      })

      it("places no order for an abandoned or declined payment, and the buyer can pay again", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        const abandoned = await startPayment(cartId)

        // Completing without paying: Paystack says the transaction was abandoned.
        const unpaid = await api.post(`/store/carts/${cartId}/complete`, {}, ada()).catch((e) => e.response)
        const declined = await startPayment(cartId)
        paystack.fail(declined.reference)
        const failed = await api.post(`/store/carts/${cartId}/complete`, {}, ada()).catch((e) => e.response)

        expect(unpaid.data.type).not.toBe("order_group")
        expect(failed.data.type).not.toBe("order_group")
        expect(await ordersOfCart(cartId)).toHaveLength(0)
        expect((await checkout(cartId)).order_group_id).toBeNull()

        const retry = await startPayment(cartId)
        expect(retry.reference).not.toBe(abandoned.reference)
        paystack.pay(retry.reference)
        await postWebhook(paystack.chargeSuccess(retry.reference))

        expect(await orderGroupOf(cartId)).toMatch(/^og_/)
        expect((await capturedWithin(cartId)).captures.map((c: any) => c.amount)).toEqual([TOTAL])
      })
    })

    it("offers only Paystack, so no cart completes without paying", async () => {
      const cartId = await adasCart()
      await prepare(cartId)
      const { data } = await api.post("/store/payment-collections", { cart_id: cartId }, ada())

      const res = await api
        .post(`/store/payment-collections/${data.payment_collection.id}/payment-sessions`, { provider_id: "pp_system_default" }, ada())
        .catch((e) => e.response)
      const { data: providers } = await api.get(`/store/payment-providers?region_id=${regionId}`, ada())

      expect(res.status).toBe(400)
      expect(res.data.message).toMatch(/pp_system_default is not enabled in the cart's region/)
      expect(providers.payment_providers.map((p: any) => p.id)).toEqual(["pp_paystack_paystack"])
    })

    describe("vendor payment capture", () => {
      it("is not the shop's to do: Paystack's webhook captures", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        const { reference } = await startPayment(cartId)
        paystack.pay(reference)
        await api.post(`/store/carts/${cartId}/complete`, {}, ada())
        const payment = await paymentOf(cartId)
        const { data } = await query().graph({
          entity: "cart",
          fields: ["payment_collection.payments.id"],
          filters: { id: cartId },
        })
        const owner = await vendorHeaders(api, GADGETS.owner.email, SEED_PASSWORD, await sellerId(GADGETS))

        const res = await api
          .post(`/vendor/payments/${data[0].payment_collection!.payments![0]!.id}/capture`, {}, owner)
          .catch((e) => e.response)

        expect(res.status).toBe(403)
        expect(payment.captured_at).toBeNull()
        expect((await paymentOf(cartId)).captured_at).toBeNull()
      })
    })
  },
})
