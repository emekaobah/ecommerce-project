import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { deleteOffersWorkflow } from "@mercurjs/core/workflows"
import { updateOfferWorkflow } from "../../src/workflows/offer-prices/update-offer"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD } from "../../src/scripts/seed-data"
import { vendorHeaders } from "../helpers/auth"
import {
  ADDRESS,
  buyerCheckout,
  eventually,
  GADGETS,
  GROCERY,
  LANTERN,
  ORDER_TOTALS,
  RETURN_URL,
  RICE,
  TOTAL,
  type Shop,
} from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { numbersIn } from "../helpers/numbers"
import { fakePaystack } from "../helpers/paystack"
import { BEST_VALUE_FEE, fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so the fake can be named in the config before it is listening.
const paystack = fakePaystack(47000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(48000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

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

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const {
      query,
      as,
      ada,
      sellerId,
      offerId,
      adasCart,
      prepare,
      startPayment,
      checkout,
      postWebhook,
      orderGroupOf,
      paymentOf,
      capturedWithin,
      ordersOfCart,
    } = buyer
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

    /** The cart's payment session for a transaction, once the webhook has had Paystack verify it. */
    const verifiedSession = async (cartId: string, reference: string) => {
      const sessionOf = async () => {
        const { data } = await query().graph({
          entity: "cart",
          fields: ["payment_collection.payment_sessions.status", "payment_collection.payment_sessions.data"],
          filters: { id: cartId },
        })
        return (data[0].payment_collection?.payment_sessions ?? []).find((s: any) => s?.data?.reference === reference) as any
      }
      return eventually(sessionOf, (session) => !!session?.data?.transaction, 200)
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
          shipping_total: 2 * BEST_VALUE_FEE,
          total: TOTAL,
          ready_to_pay: true,
          order_group_id: null,
        })
        expect(
          data.checkout.sellers.map((g: any) => [g.seller.name, g.item_subtotal, g.shipping?.amount])
        ).toEqual([
          [GADGETS.name, LANTERN.price, BEST_VALUE_FEE],
          [GROCERY.name, 2 * RICE.price, BEST_VALUE_FEE],
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
        expect(data.checkout.shipping_total).toBe(2 * BEST_VALUE_FEE)
        expect(data.checkout.total).toBe(TOTAL)
      })

      it("reprices every line at its shop's current price, and says which changed", async () => {
        const cartId = await adasCart()
        const lantern = await offerId(GADGETS, LANTERN.title)
        await updateOfferWorkflow(getContainer()).run({
          input: { offer: { id: lantern, prices: [{ amount: LANTERN.price + 1000, currency_code: "ngn" }] } },
        })

        const { data } = await prepare(cartId)

        expect(data.checkout.sellers[0].items.map((i: any) => i.unit_price)).toEqual([LANTERN.price + 1000])
        expect(data.checkout.total).toBe(TOTAL + 1000)
        expect(data.price_changes.map((c: any) => [c.product_title, c.was.unit_price, c.now.unit_price])).toEqual([
          [LANTERN.title, LANTERN.price, LANTERN.price + 1000],
        ])
        // Already repriced: preparing again reports nothing new.
        expect((await prepare(cartId)).data.price_changes).toEqual([])
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
            status(api.post(`/store/carts/${cartId}/checkout`, { shipping_address: ADDRESS }, { headers: buyer.headers() })),
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

      it("only returns the buyer to an http(s) page, which Paystack will redirect to", async () => {
        const cartId = await adasCart()
        await prepare(cartId)

        const res = await api
          .post(`/store/carts/${cartId}/checkout/payment`, { return_url: "oja://checkout/paid" }, ada())
          .catch((e) => e.response)

        expect(res.status).toBe(400)
      })

      it("won't start a payment before the address and delivery are set", async () => {
        const cartId = await adasCart()

        const res = await api
          .post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())
          .catch((e) => e.response)

        expect(res.status).toBe(400)
        expect((await checkout(cartId)).ready_to_pay).toBe(false)
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
          { shop: GADGETS.name, items: [[LANTERN.title, 1, LANTERN.price]], total: LANTERN.price + BEST_VALUE_FEE },
          { shop: GROCERY.name, items: [[RICE.title, 2, RICE.price]], total: 2 * RICE.price + BEST_VALUE_FEE },
        ])
        // No stray single order besides the split ones.
        expect(await ordersOfCart(cartId)).toHaveLength(2)
        const payment = await capturedWithin(cartId)
        expect(payment.captures.map((c: any) => c.amount)).toEqual([TOTAL])
      })

      it("places the order and captures once when Paystack delivers the same webhook twice", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        const { reference } = await startPayment(cartId)
        paystack.pay(reference)
        const webhook = paystack.chargeSuccess(reference)

        await postWebhook(webhook)
        await orderGroupOf(cartId)
        await capturedWithin(cartId)
        await postWebhook(webhook)
        // Mercur's webhook route queues each event 5s late (its default `webhook_delay`): let the
        // repeat run before checking nothing doubled.
        await new Promise((resolve) => setTimeout(resolve, 8000))

        const { data: groups } = await query().graph({ entity: "order_group", fields: ["id"], filters: { cart_id: cartId } })
        expect(groups).toHaveLength(1)
        expect(await ordersOfCart(cartId)).toHaveLength(2)
        expect((await paymentOf(cartId)).captures.map((c: any) => c.amount)).toEqual([TOTAL])
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

      it("won't place the order from the store's complete route: only Paystack's webhook does", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        const { reference } = await startPayment(cartId)
        paystack.pay(reference)

        const res = await api.post(`/store/carts/${cartId}/complete`, {}, ada()).catch((e) => e.response)

        expect(res.status).toBe(409)
        expect(await ordersOfCart(cartId)).toHaveLength(0)
        expect(await paymentOf(cartId)).toBeNull()

        await postWebhook(paystack.chargeSuccess(reference))

        expect(await orderGroupOf(cartId)).toMatch(/^og_/)
        expect((await capturedWithin(cartId)).captures.map((c: any) => c.amount)).toEqual([TOTAL])
      })

      it("places no order for an abandoned or declined payment, even on a signed webhook, and the buyer can pay again", async () => {
        const cartId = await adasCart()
        await prepare(cartId)

        // Signed, but Paystack's API says the transaction took no money.
        const abandoned = await startPayment(cartId)
        await postWebhook(paystack.chargeSuccess(abandoned.reference))
        expect(await verifiedSession(cartId, abandoned.reference)).toMatchObject({ status: "pending" })
        const declined = await startPayment(cartId)
        paystack.fail(declined.reference)
        await postWebhook(paystack.chargeSuccess(declined.reference))
        expect(await verifiedSession(cartId, declined.reference)).toMatchObject({ status: "error" })

        expect(await ordersOfCart(cartId)).toHaveLength(0)
        expect((await checkout(cartId)).order_group_id).toBeNull()
        expect(await paymentOf(cartId)).toBeNull()

        const retry = await startPayment(cartId)
        paystack.pay(retry.reference)
        await postWebhook(paystack.chargeSuccess(retry.reference))

        expect(await orderGroupOf(cartId)).toMatch(/^og_/)
        expect((await capturedWithin(cartId)).captures.map((c: any) => c.amount)).toEqual([TOTAL])
      })

      it("won't start a second payment once the first went through, so the buyer isn't charged twice", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        const paid = await startPayment(cartId)
        // Paid on Paystack's page, but the webhook hasn't arrived yet.
        paystack.pay(paid.reference)

        const again = await api
          .post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())
          .catch((e) => e.response)

        expect(again.status).toBe(409)
        expect(again.data.message).toMatch(/already paid/i)

        await postWebhook(paystack.chargeSuccess(paid.reference))

        expect(await orderGroupOf(cartId)).toMatch(/^og_/)
        expect((await capturedWithin(cartId)).captures.map((c: any) => c.amount)).toEqual([TOTAL])
      })
    })

    describe("repricing before payment", () => {
      const setPrice = async (shop: Shop, title: string, amount: number) =>
        updateOfferWorkflow(getContainer()).run({
          input: { offer: { id: await offerId(shop, title), prices: [{ amount, currency_code: "ngn" }] } },
        })
      /** An active price list giving the shop's offer of a product its own price; returns its id. */
      const priceList = async (shop: Shop, title: string, type: "sale", amount: number) => {
        const offer = await offerId(shop, title)
        const { data: offers } = await query().graph({
          entity: "offer",
          fields: ["product_variant.price_set.id"],
          filters: { id: offer },
        })
        const [list] = await getContainer()
          .resolve(Modules.PRICING)
          .createPriceLists([
            {
              title: `${shop.name} ${type}`,
              description: `${shop.name}'s ${title} ${type}`,
              type,
              status: "active",
              prices: [
                {
                  amount,
                  currency_code: "ngn",
                  price_set_id: offers[0].product_variant!.price_set!.id,
                  rules: { offer_id: offer },
                },
              ],
            },
          ])
        return list.id
      }
      const pay = (cartId: string) => api.post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())

      it("tells the buyer what a shop's new price is before they pay, then charges it", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        await setPrice(GADGETS, LANTERN.title, LANTERN.price + 1000)

        const { data } = await pay(cartId)

        // No payment yet: the buyer sees the new price first.
        expect(data.payment).toBeNull()
        expect(data.price_changes).toEqual([
          expect.objectContaining({
            product_title: LANTERN.title,
            seller: expect.objectContaining({ name: GADGETS.name }),
            quantity: 1,
            was: { unit_price: LANTERN.price, compare_at_unit_price: null, is_tax_inclusive: true },
            now: { unit_price: LANTERN.price + 1000, compare_at_unit_price: null, is_tax_inclusive: true },
          }),
        ])
        expect(data.checkout.total).toBe(TOTAL + 1000)

        const again = await pay(cartId)

        expect(again.data.price_changes).toEqual([])
        expect(paystack.transaction(again.data.payment.reference).amount).toBe((TOTAL + 1000) * 100)
      })

      it("charges the shop's normal price once a sale ends after the buyer added the item", async () => {
        const sale = await priceList(GADGETS, LANTERN.title, "sale", LANTERN.price - 800)
        const cartId = await adasCart()
        const { data: onSale } = await prepare(cartId)
        expect(onSale.checkout.total).toBe(TOTAL - 800)
        await getContainer().resolve(Modules.PRICING).deletePriceLists([sale])

        const { data } = await pay(cartId)

        expect(data.payment).toBeNull()
        expect(data.price_changes.map((c: any) => [c.product_title, c.was, c.now])).toEqual([
          [
            LANTERN.title,
            { unit_price: LANTERN.price - 800, compare_at_unit_price: LANTERN.price, is_tax_inclusive: true },
            { unit_price: LANTERN.price, compare_at_unit_price: null, is_tax_inclusive: true },
          ],
        ])
        const { reference } = await startPayment(cartId)
        expect(paystack.transaction(reference).amount).toBe(TOTAL * 100)
      })

      it("keeps each shop's own price for one variant both sell, through to their orders", async () => {
        const groceryLantern = LANTERN.also_at![0].price
        const { data: created } = await api.post("/store/carts", { region_id: buyer.regionId() }, ada())
        const cartId = created.cart.id as string
        for (const shop of [GADGETS, GROCERY]) {
          await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(shop, LANTERN.title), quantity: 1 }, ada())
        }
        await prepare(cartId)
        await setPrice(GROCERY, LANTERN.title, groceryLantern + 500)

        const { data } = await pay(cartId)

        // Only the grocery's line changed; the gadget hub's keeps its own price.
        expect(data.price_changes.map((c: any) => [c.seller.name, c.was.unit_price, c.now.unit_price])).toEqual([
          [GROCERY.name, groceryLantern, groceryLantern + 500],
        ])
        const total = LANTERN.price + groceryLantern + 500 + 2 * BEST_VALUE_FEE
        const { reference } = await startPayment(cartId)
        expect(paystack.transaction(reference).amount).toBe(total * 100)
        paystack.pay(reference)
        await postWebhook(paystack.chargeSuccess(reference))

        const { data: group } = await api.get(`/store/order-groups/${await orderGroupOf(cartId)}?fields=${ORDER_GROUP_FIELDS}`, ada())
        expect(
          group.order_group.orders
            .map((o: any) => [o.seller.name, o.items.map((i: any) => i.unit_price)])
            .sort((a: any, b: any) => a[0].localeCompare(b[0]))
        ).toEqual([
          [GADGETS.name, [LANTERN.price]],
          [GROCERY.name, [groceryLantern + 500]],
        ])
        expect(group.order_group.total).toBe(total)
      })

      it("adds VAT on top once the currency's prices stop including it", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        await getContainer()
          .resolve(Modules.PRICING)
          .updatePricePreferences({ attribute: "currency_code", value: "ngn" }, { is_tax_inclusive: false })

        const { data } = await pay(cartId)

        expect(data.price_changes.map((c: any) => [c.product_title, c.was.is_tax_inclusive, c.now.is_tax_inclusive])).toEqual([
          [LANTERN.title, true, false],
          [RICE.title, true, false],
        ])
        const items = LANTERN.price + 2 * RICE.price
        expect(data.checkout.total).toBe(TOTAL + items * 0.075)
      })

      it("won't take payment for a line whose offer is gone until the buyer removes it", async () => {
        const cartId = await adasCart()
        await prepare(cartId)
        await deleteOffersWorkflow(getContainer()).run({ input: { ids: [await offerId(GROCERY, RICE.title)] } })

        const refused = await pay(cartId).catch((e) => e.response)

        expect(refused.status).toBe(400)
        expect(refused.data.message).toMatch(/no longer sold by their shop/i)
        const gone = (await checkout(cartId)).sellers.find((g: any) => !g.seller)
        expect(gone.items.map((i: any) => i.product_title)).toEqual([RICE.title])

        await api.delete(`/store/carts/${cartId}/line-items/${gone.items[0].id}`, ada())
        const { reference } = await startPayment(cartId)

        // Nor for the delivery of a shop the cart no longer holds anything from.
        expect(paystack.transaction(reference).amount).toBe((LANTERN.price + BEST_VALUE_FEE) * 100)
      })
    })

    it("offers only Paystack, so no cart completes without paying", async () => {
      const cartId = await adasCart()
      await prepare(cartId)
      const { data } = await api.post("/store/payment-collections", { cart_id: cartId }, ada())

      const res = await api
        .post(`/store/payment-collections/${data.payment_collection.id}/payment-sessions`, { provider_id: "pp_system_default" }, ada())
        .catch((e) => e.response)
      const { data: providers } = await api.get(`/store/payment-providers?region_id=${buyer.regionId()}`, ada())

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
        await postWebhook(paystack.chargeSuccess(reference))
        await orderGroupOf(cartId)
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
      })
    })

    describe("what a shop sees of its order", () => {
      /** Ada pays for her cart, and it is split into an order per shop. */
      const paidCheckout = async () => (await buyer.paidCheckout()).cartId
      const shopOrders = async (shop: Shop, cartId: string, fields: string) => {
        const owner = await vendorHeaders(api, shop.owner.email, SEED_PASSWORD, await sellerId(shop))
        const { data: carts } = await query().graph({ entity: "order_cart", fields: ["order_id"], filters: { cart_id: cartId } })
        const cartOrderIds = new Set(carts.map((c: any) => c.order_id))
        const { data: list } = await api.get(`/vendor/orders?limit=50&fields=${fields}`, owner)
        const listed = list.orders.filter((o: any) => cartOrderIds.has(o.id))
        expect(listed).toHaveLength(1)
        const { data: detail } = await api.get(`/vendor/orders/${listed[0].id}?fields=${fields}`, owner)
        return { listed: listed[0], order: detail.order }
      }
      // The order line and payment fields the web vendor panel's order page asks for.
      const PANEL_FIELDS = "+total,*items.variant.prices,+items.compare_at_unit_price"

      it("never shows a shop where the buyer's pin is, even asked for the address (ADR 0002)", async () => {
        const cartId = await buyer.adasCart()
        const pinned = { ...ADDRESS, metadata: { ...ADDRESS.metadata, latitude: 6.4281, longitude: 3.4219 } }
        await api.post(`/store/carts/${cartId}/checkout`, { shipping_address: pinned }, buyer.ada())
        const { reference } = await buyer.startPayment(cartId)
        paystack.pay(reference)
        await buyer.postWebhook(paystack.chargeSuccess(reference))
        await buyer.orderGroupOf(cartId)

        for (const fields of ["", "*shipping_address"]) {
          const { listed, order } = await shopOrders(GADGETS, cartId, fields)
          for (const seen of [listed, order]) {
            expect(JSON.stringify(seen)).not.toMatch(/latitude|longitude|6\.4281|3\.4219/)
          }
        }
      })

      it("shows each shop the payment for its own order, not the whole checkout's", async () => {
        const cartId = await paidCheckout()

        for (const [shop, total] of [
          [GADGETS, LANTERN.price + BEST_VALUE_FEE],
          [GROCERY, 2 * RICE.price + BEST_VALUE_FEE],
        ] as const) {
          const { listed, order } = await shopOrders(shop, cartId, PANEL_FIELDS)
          for (const seen of [listed, order]) {
            expect(seen.total).toBe(total)
            expect(seen.payment_status).toBe("captured")
            const [collection, ...others] = seen.payment_collections
            expect(others).toEqual([])
            // What the panel shows as Paid Total, and its payment line.
            expect(collection.captured_amount - collection.refunded_amount).toBe(total)
            expect(collection.amount).toBe(total)
            expect(collection.payments.map((p: any) => p.amount)).toEqual([total])
            // Paystack charges in kobo.
            expect(numbersIn(seen)).not.toEqual(expect.arrayContaining([TOTAL]))
            expect(numbersIn(seen)).not.toEqual(expect.arrayContaining([TOTAL * 100]))
          }
        }
      })

      it("shows no other shop's price for a product both sell, nor strikes one through", async () => {
        const cartId = await paidCheckout()
        const { data: rivals } = await query().graph({
          entity: "offer",
          fields: ["prices.id", "prices.amount"],
          filters: { id: await offerId(GROCERY, LANTERN.title) },
        })
        const rivalPrices = rivals[0].prices as { id: string; amount: number }[]

        const { listed, order } = await shopOrders(GADGETS, cartId, PANEL_FIELDS)

        for (const seen of [listed, order]) {
          const body = JSON.stringify(seen)
          for (const price of rivalPrices) {
            expect(body).not.toContain(price.id)
            expect(numbersIn(seen)).not.toEqual(expect.arrayContaining([Number(price.amount)]))
          }
          // The panel strikes the variant's price through when it differs from the line's.
          const [line] = seen.items
          expect(line.unit_price).toBe(LANTERN.price)
          expect(line.variant.prices.find((p: any) => p.currency_code === "ngn").amount).toBe(line.unit_price)
        }
      })

      it("shows the shop only its own order when it acts on it and in the order's preview", async () => {
        const cartId = await paidCheckout()
        const total = LANTERN.price + BEST_VALUE_FEE
        const owner = await vendorHeaders(api, GADGETS.owner.email, SEED_PASSWORD, await sellerId(GADGETS))
        const { order } = await shopOrders(GADGETS, cartId, PANEL_FIELDS)
        const [line] = order.items
        const items = [{ id: line.id, quantity: 1 }]
        // A courier fulfilment comes only from booking the label (#24).
        for (const step of ["accept", "start-picking", `pick-list/${line.id}`, "pack", "book-label"]) {
          await api.post(`/vendor/orders/${order.id}/${step}`, step.startsWith("pick-list") ? { picked: 1 } : {}, owner)
        }
        const { data: booked } = await query().graph({ entity: "order", fields: ["fulfillments.id"], filters: { id: order.id } })
        const fulfillment = booked[0].fulfillments![0]!.id

        const responses = [
          (await api.post(`/vendor/orders/${order.id}/fulfillments/${fulfillment}/shipments?fields=${PANEL_FIELDS}`, { items }, owner)).data,
          (await api.post(`/vendor/orders/${order.id}/fulfillments/${fulfillment}/mark-as-delivered?fields=${PANEL_FIELDS}`, {}, owner)).data,
          (await api.post(`/vendor/orders/${order.id}/complete?fields=${PANEL_FIELDS}`, {}, owner)).data,
          (await api.get(`/vendor/orders/${order.id}/preview`, owner)).data,
        ]

        for (const seen of responses) {
          expect(seen.order.id).toBe(order.id)
          expect(seen.order).not.toHaveProperty("cart")
          expect(numbersIn(seen)).not.toEqual(expect.arrayContaining([TOTAL]))
          expect(numbersIn(seen)).not.toEqual(expect.arrayContaining([TOTAL * 100]))
        }
        for (const seen of responses.slice(0, 3)) {
          expect(seen.order.payment_collections.map((c: any) => c.captured_amount)).toEqual([total])
          expect(seen.order.items[0].variant.prices.map((p: any) => p.amount)).toEqual([LANTERN.price])
        }
      })

      const paymentIdOf = async (cartId: string) => {
        const { data } = await query().graph({
          entity: "cart",
          fields: ["payment_collection.payments.id"],
          filters: { id: cartId },
        })
        return data[0].payment_collection!.payments![0]!.id as string
      }

      it("shows each shop its own share of the checkout's payment in the vendor payments API", async () => {
        const cartId = await paidCheckout()
        const paymentId = await paymentIdOf(cartId)

        for (const [shop, total] of [
          [GADGETS, LANTERN.price + BEST_VALUE_FEE],
          [GROCERY, 2 * RICE.price + BEST_VALUE_FEE],
        ] as const) {
          const owner = await vendorHeaders(api, shop.owner.email, SEED_PASSWORD, await sellerId(shop))
          // Mercur 2.3.5's payment list filters through a link that doesn't exist and always
          // fails, so only a payment's own route shows a shop the payment.
          const { data } = await api.get(`/vendor/payments/${paymentId}?fields=+data,+payment_session.*`, owner)

          expect(data.payment.amount).toBe(total)
          expect(data.payment.captures.map((c: any) => c.amount)).toEqual([total])
          expect(numbersIn(data)).not.toEqual(expect.arrayContaining([TOTAL]))
          expect(numbersIn(data)).not.toEqual(expect.arrayContaining([TOTAL * 100]))
        }
      })

      it("refunds only the shop's own order's share when it refunds a split checkout's payment from the panel", async () => {
        const { cartId, reference } = await buyer.paidCheckout()
        const paymentId = await paymentIdOf(cartId)
        const owner = await vendorHeaders(api, GADGETS.owner.email, SEED_PASSWORD, await sellerId(GADGETS))
        const share = ORDER_TOTALS.get(GADGETS)!

        // The whole checkout's payment isn't the shop's to refund.
        expect(await status(api.post(`/vendor/payments/${paymentId}/refund`, { amount: TOTAL }, owner))).toBe(400)
        expect(paystack.refundsOf(reference)).toEqual([])

        const { data } = await api.post(`/vendor/payments/${paymentId}/refund`, { amount: share }, owner)

        // Shown as the shop's share, refunded in full; Paystack refunded that share alone (kobo).
        expect(data.payment.refunds.map((r: any) => r.amount)).toEqual([share])
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([share * 100])
        const grocer = await vendorHeaders(api, GROCERY.owner.email, SEED_PASSWORD, await sellerId(GROCERY))
        const { data: other } = await api.get(`/vendor/payments/${paymentId}`, grocer)
        expect(other.payment.refunds).toEqual([])
        expect(other.payment.captures.map((c: any) => c.amount)).toEqual([ORDER_TOTALS.get(GROCERY)])
      })

      it("still strikes through the shop's normal price when its own offer was on sale", async () => {
        const pricing = getContainer().resolve(Modules.PRICING)
        const lantern = await offerId(GADGETS, LANTERN.title)
        const { data: offers } = await query().graph({
          entity: "offer",
          fields: ["product_variant.price_set.id"],
          filters: { id: lantern },
        })
        const [sale] = await pricing.createPriceLists([
          {
            title: "Lantern sale",
            description: "Ikeja Gadget Hub's lantern sale",
            type: "sale",
            status: "active",
            prices: [
              {
                amount: LANTERN.price - 800,
                currency_code: "ngn",
                price_set_id: offers[0].product_variant!.price_set!.id,
                rules: { offer_id: lantern },
              },
            ],
          },
        ])
        try {
          const cartId = await paidCheckout()

          const { order } = await shopOrders(GADGETS, cartId, PANEL_FIELDS)

          const [line] = order.items
          expect([line.unit_price, line.compare_at_unit_price]).toEqual([LANTERN.price - 800, LANTERN.price])
          expect(line.variant.prices.find((p: any) => p.currency_code === "ngn").amount).toBe(LANTERN.price)
        } finally {
          await pricing.deletePriceLists([sale.id])
        }
      })
    })
  },
})
