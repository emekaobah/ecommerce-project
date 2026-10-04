import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ADDRESS, buyerCheckout, GADGETS, GROCERY, LANTERN, RETURN_URL, RICE, TOTAL } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { BEST_VALUE_FEE, COURIERS, fakeShipbubble } from "../helpers/shipbubble"
import seedDemoData from "../../src/scripts/seed"

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
const PIN = { latitude: 6.4281, longitude: 3.4219 }
const PINNED = { ...ADDRESS, metadata: { ...ADDRESS.metadata, ...PIN } }

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
      await seedDemoData({ container: getContainer(), args: [] } as any)
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

      it("sends the address text alone when there's no pin", async () => {
        const cartId = await adasCart()

        await prepareAt(cartId, ADDRESS)

        const [validation] = adasValidations()
        expect(validation.address).toBe("3 Akin Adesola Street, Flat 4, Eti-Osa, Lagos, Nigeria")
        expect(validation).not.toHaveProperty("latitude")
        expect(validation).not.toHaveProperty("longitude")
      })

      it("validates again only an address without a code", async () => {
        const cartId = await adasCart()
        await prepareAt(cartId, PINNED)
        // The app sends the address back as the buyer saw it, without the code.
        await prepareAt(cartId, { ...PINNED, address_2: "Flat 4B" })
        expect(adasValidations()).toHaveLength(1)

        // A saved address validated earlier brings its code.
        const saved = await adasCart()
        const code = shipbubble.codeOf(`${PIN.latitude},${PIN.longitude}`)
        await prepareAt(saved, { ...ADDRESS, metadata: { shipbubble_address_code: code } })
        expect(adasValidations()).toHaveLength(1)

        // Moving the pin is a new place.
        await prepareAt(cartId, { ...PINNED, metadata: { ...PINNED.metadata, latitude: 6.5 } })
        expect(adasValidations()).toHaveLength(2)
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
        const [gadgets, grocery] = requests
        expect(gadgets.package_items).toEqual([
          { name: LANTERN.title, description: LANTERN.title, unit_weight: "0.6", unit_amount: String(LANTERN.price), quantity: "1" },
        ])
        expect(grocery.package_items).toEqual([
          { name: RICE.title, description: RICE.title, unit_weight: "5", unit_amount: String(RICE.price), quantity: "2" },
        ])
        // Groceries go as food, so couriers that carry food quote it.
        expect(grocery.category_id).toBe(69709726)
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
        expect(shipbubble.rateRequests().at(-1)!.package_items[0].quantity).toBe("3")
      })
    })
  },
})
