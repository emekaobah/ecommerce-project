import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { ADDRESS, buyerCheckout, GADGETS, GROCERY, LANTERN, PIN, RETURN_URL, RICE, TOTAL } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { BEST_VALUE_FEE, COURIERS, categoryId, fakeShipbubble } from "../helpers/shipbubble"
import { seedDemoWorld } from "../../src/scripts/seed"
import { SEED_SELLERS } from "../../src/scripts/seed-data"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so the fakes can be named in the config before they listen.
const paystack = fakePaystack(51000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(53000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which reads them when registering the providers.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

/** Ada's address with the pin she confirmed on the map (ADR 0002). */
const PINNED = ADDRESS
const FASHION = SEED_SELLERS.find((s) => s.name === "Adire House")!

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const { ada, adasCart, checkout } = buyer
    const prepareAt = (cartId: string, address: unknown) =>
      api.post(`/store/carts/${cartId}/checkout`, { shipping_address: address }, ada())
    /** The validations Shipbubble was asked for of Ada's own address. */
    const adasValidations = () => shipbubble.validations().filter((v) => v.email === "ada@oja.test")

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      await buyer.load()
    })

    describe("validating the delivery address", () => {
      it("sends the pin's coordinates with the address text and keeps Shipbubble's address code", async () => {
        const cartId = await adasCart()

        const { data } = await prepareAt(cartId, PINNED)

        expect(adasValidations()).toEqual([
          {
            name: "Ada Obi",
            email: "ada@oja.test",
            phone: ADDRESS.phone,
            address: "3 Akin Adesola Street, Flat 4, Eti-Osa, Lagos, Nigeria",
            ...PIN,
          },
        ])
        const code = shipbubble.codeOf(`${PIN.latitude},${PIN.longitude}`)
        expect(code).toEqual(expect.any(Number))
        expect(data.checkout.shipping_address.metadata).toEqual({
          landmark: ADDRESS.metadata.landmark,
          ...PIN,
          shipbubble_address_code: code,
        })
      })

      it("refuses an address without a pin, before asking Shipbubble", async () => {
        const cartId = await adasCart()
        const { latitude: _latitude, longitude: _longitude, ...unpinned } = ADDRESS.metadata

        const res = await prepareAt(cartId, { ...ADDRESS, metadata: unpinned }).catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/pin/)
        expect(adasValidations()).toEqual([])
      })

      it("validates again only an address without a code", async () => {
        const cartId = await adasCart()
        await prepareAt(cartId, PINNED)
        // The app sends the address back as the buyer saw it, without the code.
        await prepareAt(cartId, { ...PINNED, address_2: "Flat 4B" })
        expect(adasValidations()).toHaveLength(1)

        // Moving the pin is a new place.
        await prepareAt(cartId, { ...PINNED, metadata: { ...PINNED.metadata, latitude: 6.5 } })
        expect(adasValidations()).toHaveLength(2)
      })

      it("never takes the buyer's word for an address code, which sets what delivery costs", async () => {
        const cartId = await adasCart()
        const elsewhere = 999999

        const { data } = await prepareAt(cartId, { ...ADDRESS, metadata: { ...ADDRESS.metadata, shipbubble_address_code: elsewhere } })

        expect(adasValidations()).toHaveLength(1)
        expect(data.checkout.shipping_address.metadata.shipbubble_address_code).not.toBe(elsewhere)
        expect(shipbubble.rateRequests().map((r) => r.reciever_address_code)).not.toContain(elsewhere)
      })

      it("refuses an address Shipbubble can't validate, with a reason, and quotes no delivery", async () => {
        const cartId = await adasCart()
        shipbubble.rejectAddresses((v) => v.email === "ada@oja.test")

        const res = await prepareAt(cartId, PINNED).catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/couldn't find this address/)
        expect(shipbubble.rateRequests()).toEqual([])
        expect((await checkout(cartId)).ready_to_pay).toBe(false)
      })
    })

    describe("rates per shop", () => {
      it("quotes each shop's parcel from its own pickup address to the buyer's, in kilograms", async () => {
        const cartId = await adasCart()

        const { data } = await prepareAt(cartId, PINNED)

        const ada = data.checkout.shipping_address.metadata.shipbubble_address_code
        const requests = shipbubble.rateRequests()
        expect(requests).toHaveLength(2)
        expect(requests.map((r) => r.reciever_address_code)).toEqual([ada, ada])
        // Each shop ships from its own validated pickup address.
        const senders = requests.map((r) => r.sender_address_code)
        expect(new Set([...senders, ada]).size).toBe(3)
        // Shops are quoted at once, so their requests come in either order.
        const requestFor = (title: string) => requests.find((r) => r.package_items[0].name === title)!
        const [gadgets, grocery] = [requestFor(LANTERN.title), requestFor(RICE.title)]
        expect(gadgets.package_items).toEqual([
          { name: LANTERN.title, description: LANTERN.title, unit_weight: "0.6", unit_amount: String(LANTERN.price), quantity: "1" },
        ])
        expect(grocery.package_items).toEqual([
          { name: RICE.title, description: RICE.title, unit_weight: "5", unit_amount: String(RICE.price), quantity: "2" },
        ])
        // Groceries go as food, so couriers that carry food quote it.
        expect(grocery.category_id).toBe(categoryId("Groceries"))
        expect(gadgets.category_id).toBe(categoryId("Electronics and gadgets"))
      })

      it("offers each shop best value, the cheapest and the fastest, with best value chosen", async () => {
        const cartId = await adasCart()

        const { data } = await prepareAt(cartId, PINNED)

        for (const group of data.checkout.sellers) {
          expect(group.delivery_choices.map((c: any) => [c.courier_name, c.amount, c.tags])).toEqual([
            [COURIERS.nextDay.courier_name, COURIERS.nextDay.amount, ["best_value"]],
            [COURIERS.bike.courier_name, COURIERS.bike.amount, ["cheapest"]],
            [COURIERS.express.courier_name, COURIERS.express.amount, ["fastest"]],
          ])
          expect(group.shipping).toMatchObject({
            name: COURIERS.nextDay.courier_name,
            amount: BEST_VALUE_FEE,
            choice_id: group.delivery_choices[0].id,
          })
        }
        expect(data.checkout).toMatchObject({ shipping_total: 2 * BEST_VALUE_FEE, total: TOTAL, ready_to_pay: true })
      })

      it("refuses checkout when no courier will take a shop's parcel", async () => {
        const cartId = await adasCart()
        shipbubble.setCouriers([])

        const res = await prepareAt(cartId, PINNED).catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/doesn't deliver to this address/)
        // Coded, with the shop named, for the app to word (#106).
        expect(res.data).toMatchObject({ type: "not_allowed", code: "shop_doesnt_deliver", offers_pickup: false })
        expect([GADGETS.name, GROCERY.name]).toContain(res.data.seller.name)
      })

      it("doesn't tell the buyer their address is wrong when Shipbubble refuses our account", async () => {
        const cartId = await adasCart()
        shipbubble.emptyWallet(true)

        const res = await prepareAt(cartId, PINNED).catch((e) => e.response)

        expect(res.status).toBe(500)
        expect(res.data.message).not.toMatch(/address|wallet|deliver/i)
      })

      it("doesn't pass off Shipbubble refusing the API key as a shop that doesn't deliver", async () => {
        const cartId = await adasCart()
        shipbubble.failRatesWith(401)

        const res = await prepareAt(cartId, PINNED).catch((e) => e.response)

        expect(res.status).toBe(500)
        expect(res.data.message).not.toMatch(/doesn't deliver/)
      })
    })

    describe("choosing a rate", () => {
      const choose = (cartId: string, sellerId: string, choiceId: string) =>
        api.post(`/store/carts/${cartId}/checkout/delivery`, { seller_id: sellerId, choice_id: choiceId }, ada())
      const choiceOf = (checkout: any, sellerId: string, tag: string) =>
        checkout.sellers.find((g: any) => g.seller.id === sellerId).delivery_choices.find((c: any) => c.tags.includes(tag))

      it("changes a shop's delivery to another of its choices and totals the cart with it", async () => {
        const cartId = await adasCart()
        const { data: prepared } = await prepareAt(cartId, PINNED)
        const gadgets = await buyer.sellerId(GADGETS)

        const { data } = await choose(cartId, gadgets, choiceOf(prepared.checkout, gadgets, "fastest").id)

        const shipping = data.checkout.sellers.map((g: any) => [g.seller.name, g.shipping.name, g.shipping.amount])
        expect(shipping).toEqual([
          [GADGETS.name, COURIERS.express.courier_name, COURIERS.express.amount],
          [GROCERY.name, COURIERS.nextDay.courier_name, BEST_VALUE_FEE],
        ])
        expect(data.checkout.shipping_total).toBe(COURIERS.express.amount + BEST_VALUE_FEE)
        expect(data.checkout.total).toBe(TOTAL - BEST_VALUE_FEE + COURIERS.express.amount)
        // The choices stay as quoted.
        expect(data.checkout.sellers[0].delivery_choices).toEqual(prepared.checkout.sellers[0].delivery_choices)
      })

      it("only takes one of the shop's quoted choices", async () => {
        const cartId = await adasCart()
        const { data: prepared } = await prepareAt(cartId, PINNED)
        const [gadgets, grocery] = [await buyer.sellerId(GADGETS), await buyer.sellerId(GROCERY)]

        const statuses = await Promise.all([
          choose(cartId, gadgets, "made-up:courier").catch((e) => e.response.status),
          // Another buyer's cart is none of theirs.
          api
            .post(
              `/store/carts/${cartId}/checkout/delivery`,
              { seller_id: grocery, choice_id: choiceOf(prepared.checkout, grocery, "cheapest").id },
              buyer.as("bola@oja.test")
            )
            .catch((e) => e.response.status),
        ])

        expect(statuses).toEqual([400, 404])
        expect((await checkout(cartId)).shipping_total).toBe(2 * BEST_VALUE_FEE)
      })

      it("won't take a delivery through the store's own shipping-methods route", async () => {
        const cartId = await adasCart()
        await prepareAt(cartId, PINNED)
        const { data: options } = await buyer
          .query()
          .graph({ entity: "shipping_option", fields: ["id"], filters: { provider_id: "shipbubble_shipbubble" } })

        const res = await api
          .post(
            `/store/carts/${cartId}/shipping-methods`,
            { option_id: options[0].id, data: { quote: { amount: 1 } } },
            ada()
          )
          .catch((e) => e.response)

        expect(res.status).toBe(400)
        expect((await checkout(cartId)).shipping_total).toBe(2 * BEST_VALUE_FEE)
      })
    })

    describe("product page delivery estimate", () => {
      const productId = async (title: string) => {
        const { data: products } = await buyer.query().graph({ entity: "product", fields: ["id"], filters: { title } })
        return products[0].id as string
      }
      const estimateOf = async (
        shop: typeof GADGETS,
        title: string,
        config: { headers: Record<string, string> },
        params: Record<string, string> = {}
      ) => {
        const query = new URLSearchParams({ region_id: buyer.regionId(), ...params })
        const { data } = await api.get(
          `/store/listings/${await buyer.sellerId(shop)}/${await productId(title)}/delivery-estimate?${query}`,
          config
        )
        return data.estimate
      }
      /** Saves the address for the buyer and returns its id. */
      const saveAddress = async (email: string, address: Record<string, unknown>) => {
        const { data } = await api.post("/store/customers/me/addresses", address, buyer.as(email))
        return data.customer.addresses.find((a: any) => a.address_1 === address.address_1).id as string
      }
      /** Another address of Chidi's, across the lagoon, pinned on the map. */
      const YABA_PIN = { latitude: 6.5095, longitude: 3.3711 }
      const YABA = { ...PINNED, address_1: "12 Herbert Macaulay Way", city: "Yaba", metadata: { ...YABA_PIN } }

      it("estimates to the address the buyer picked rather than their default", async () => {
        await saveAddress("chidi@oja.test", { ...PINNED, first_name: "Chidi", is_default_shipping: true })
        const yaba = await saveAddress("chidi@oja.test", { ...YABA, first_name: "Chidi" })

        expect(await estimateOf(GROCERY, RICE.title, buyer.as("chidi@oja.test"), { address_id: yaba })).toMatchObject({
          amount: BEST_VALUE_FEE,
        })

        const [request] = shipbubble.rateRequests()
        expect(request.reciever_address_code).toBe(shipbubble.codeOf(`${YABA_PIN.latitude},${YABA_PIN.longitude}`))
      })

      it("ignores an address that isn't the buyer's, estimating to their default as listings do", async () => {
        await saveAddress("chidi@oja.test", { ...PINNED, first_name: "Chidi", is_default_shipping: true })
        const dayos = await saveAddress("dayo@oja.test", { ...YABA, first_name: "Dayo" })

        await estimateOf(GROCERY, RICE.title, buyer.as("chidi@oja.test"), { address_id: dayos })

        const [request] = shipbubble.rateRequests()
        expect(request.reciever_address_code).toBe(shipbubble.codeOf(`${PIN.latitude},${PIN.longitude}`))
      })

      it("estimates the size the buyer picked, by its own weight", async () => {
        await saveAddress("chidi@oja.test", { ...PINNED, first_name: "Chidi", is_default_shipping: true })
        const { data: variants } = await buyer
          .query()
          .graph({ entity: "product_variant", fields: ["id", "title"], filters: { product_id: await productId("Adire Kaftan") } })
        const xl = variants.find((v: any) => v.title === "XL")!
        // The XL ships heavier than the other sizes.
        await getContainer().resolve(Modules.PRODUCT).updateProductVariants(xl.id, { weight: 2000 })

        await estimateOf(FASHION, "Adire Kaftan", buyer.as("chidi@oja.test"), { variant_id: xl.id })

        const [request] = shipbubble.rateRequests()
        expect(request.package_items).toEqual([expect.objectContaining({ unit_weight: "2", quantity: "1" })])
      })

      it("refuses a variant the listing's shop doesn't sell", async () => {
        await saveAddress("chidi@oja.test", { ...PINNED, first_name: "Chidi", is_default_shipping: true })
        const { data: lanterns } = await buyer
          .query()
          .graph({ entity: "product_variant", fields: ["id"], filters: { product_id: await productId(LANTERN.title) } })

        const status = await estimateOf(GROCERY, RICE.title, buyer.as("chidi@oja.test"), { variant_id: lanterns[0].id }).then(
          () => 200,
          (e: any) => e.response?.status
        )

        expect(status).toBe(404)
        expect(shipbubble.rateRequests()).toEqual([])
      })

      it("estimates the listing's shop's best-value delivery to the buyer's saved address", async () => {
        await saveAddress("chidi@oja.test", { ...PINNED, first_name: "Chidi", is_default_shipping: true })

        const estimate = await estimateOf(GROCERY, RICE.title, buyer.as("chidi@oja.test"))

        expect(estimate).toEqual({
          courier_name: COURIERS.nextDay.courier_name,
          amount: BEST_VALUE_FEE,
          delivery_eta: expect.any(String),
          delivery_eta_time: expect.stringMatching(/\+01:00$/),
          time_zone: "Africa/Lagos",
        })
        // One of the product, from that shop, to the saved address, validated by its pin.
        const [request] = shipbubble.rateRequests()
        expect(request.package_items).toEqual([
          { name: RICE.title, description: RICE.title, unit_weight: "5", unit_amount: String(RICE.price), quantity: "1" },
        ])
        expect(request.reciever_address_code).toBe(shipbubble.codeOf(`${PIN.latitude},${PIN.longitude}`))
        expect(shipbubble.validations().filter((v) => v.email === "chidi@oja.test")).toHaveLength(1)

        // The saved address keeps its code, so the next estimate needs no validation.
        await estimateOf(GADGETS, LANTERN.title, buyer.as("chidi@oja.test"))
        expect(shipbubble.validations().filter((v) => v.email === "chidi@oja.test")).toHaveLength(1)
        const { data } = await api.get("/store/customers/me/addresses", buyer.as("chidi@oja.test"))
        expect(data.addresses[0].metadata.shipbubble_address_code).toBe(request.reciever_address_code)
      })

      it("has none for a guest or a buyer without a saved address, who see the shop's dispatch time", async () => {
        expect(await estimateOf(GROCERY, RICE.title, buyer.as("dayo@oja.test"))).toBeNull()
        expect(await estimateOf(GROCERY, RICE.title, { headers: buyer.headers() })).toBeNull()
        expect(shipbubble.rateRequests()).toEqual([])
      })

      it("refuses the phone's location, since an estimate needs a saved, validated address (ADR 0015)", async () => {
        const status = await estimateOf(GROCERY, RICE.title, { headers: buyer.headers() }, { near: "6.59,3.35" }).then(
          () => 200,
          (e: any) => e.response?.status
        )

        expect(status).toBe(400)
        expect(shipbubble.rateRequests()).toEqual([])
      })

      it("has none when no courier will take the parcel", async () => {
        await saveAddress("emeka@oja.test", { ...PINNED, first_name: "Emeka" })
        shipbubble.setCouriers([])

        expect(await estimateOf(GROCERY, RICE.title, buyer.as("emeka@oja.test"))).toBeNull()
      })
    })

    describe("paying", () => {
      it("charges the items and each shop's chosen rate, and each shop's order carries its rate", async () => {
        const cartId = await adasCart()
        const { data: prepared } = await prepareAt(cartId, PINNED)
        const gadgets = await buyer.sellerId(GADGETS)
        const cheapest = prepared.checkout.sellers
          .find((g: any) => g.seller.id === gadgets)
          .delivery_choices.find((c: any) => c.tags.includes("cheapest"))
        await api.post(`/store/carts/${cartId}/checkout/delivery`, { seller_id: gadgets, choice_id: cheapest.id }, ada())
        const total = TOTAL - BEST_VALUE_FEE + COURIERS.bike.amount

        const { reference } = await buyer.startPayment(cartId)
        paystack.pay(reference)
        await buyer.postWebhook(paystack.chargeSuccess(reference))
        await buyer.orderGroupOf(cartId)

        expect(paystack.transaction(reference).amount).toBe(total * 100)
        const orders = await Promise.all(
          [GADGETS, GROCERY].map(async (shop) => {
            const { data } = await buyer.query().graph({
              entity: "order",
              fields: ["total", "shipping_total", "shipping_methods.amount", "shipping_methods.data"],
              filters: { id: await buyer.shopOrderId(shop, cartId) },
            })
            return data[0] as any
          })
        )
        expect(orders.map((o) => [Number(o.shipping_total), Number(o.total)])).toEqual([
          [COURIERS.bike.amount, LANTERN.price + COURIERS.bike.amount],
          [BEST_VALUE_FEE, 2 * RICE.price + BEST_VALUE_FEE],
        ])
        // The courier booked later (#24) is on the order.
        expect(orders[0].shipping_methods[0].data.quote).toMatchObject({
          courier_id: COURIERS.bike.courier_id,
          service_code: COURIERS.bike.service_code,
          request_token: expect.stringMatching(/^token_/),
        })
      })

      it("quotes delivery again once the cart has changed since", async () => {
        const cartId = await adasCart()
        await prepareAt(cartId, PINNED)
        await api.post(
          `/store/carts/${cartId}/line-items`,
          { offer_id: await buyer.offerId(GROCERY, RICE.title), quantity: 1 },
          ada()
        )

        const stale = await checkout(cartId)
        const grocery = stale.sellers.find((g: any) => g.seller.name === GROCERY.name)
        expect([grocery.shipping, stale.ready_to_pay]).toEqual([null, false])
        const res = await api
          .post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())
          .catch((e) => e.response)
        expect(res.status).toBe(400)

        const { data } = await prepareAt(cartId, stale.shipping_address)
        expect(data.checkout.ready_to_pay).toBe(true)
        const riceQuotes = shipbubble.rateRequests().filter((r) => r.package_items[0].name === RICE.title)
        expect(riceQuotes.at(-1)!.package_items[0].quantity).toBe("3")
      })
    })
  },
})
