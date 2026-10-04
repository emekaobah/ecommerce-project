import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ADDRESS, buyerCheckout, GADGETS } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakeGoogle, PLACES } from "../helpers/google"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"
import seedDemoData from "../../src/scripts/seed"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so the fakes can be named in the config before they listen.
const paystack = fakePaystack(54000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(55000 + (process.pid % 1000))
const google = fakeGoogle(56000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which reads them when registering the providers.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.GOOGLE_MAPS_API_KEY = google.apiKey
process.env.GOOGLE_PLACES_API_URL = google.placesUrl
process.env.GOOGLE_GEOCODING_API_URL = google.geocodingUrl

const SESSION = "4f1d1c43-1d9a-4b3e-9b0c-6a1f0b6f2c11"
/** Ada's address with the pin she confirmed on the map. */
const PIN = { latitude: 6.4281, longitude: 3.4219 }
const PINNED = { ...ADDRESS, metadata: { ...ADDRESS.metadata, ...PIN } }

/** Every `latitude` or `longitude` anywhere in a response. */
const coordinatesIn = (body: unknown): string[] =>
  JSON.stringify(body).match(/"(latitude|longitude)":/g) ?? []

// Buyers find their delivery address with Google's help, through the backend (ADR 0002, #40).
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const { ada } = buyer
    const guest = () => ({ headers: buyer.headers() })
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )
    const newCart = async () => (await api.post("/store/carts", { region_id: buyer.regionId() }, ada())).data.cart.id as string
    const suggest = (cartId: string, input: string, as: object = ada()) =>
      api.get(`/store/address-lookup/suggestions?cart_id=${cartId}&session_token=${SESSION}&input=${encodeURIComponent(input)}`, as)
    const details = (cartId: string, placeId: string, as: object = ada()) =>
      api.get(`/store/address-lookup/places/${placeId}?cart_id=${cartId}&session_token=${SESSION}`, as)
    const addressAt = (cartId: string, { latitude, longitude }: { latitude: number; longitude: number }, as: object = ada()) =>
      api.get(`/store/address-lookup/reverse-geocode?cart_id=${cartId}&latitude=${latitude}&longitude=${longitude}`, as)

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), google.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), google.stop()]))
    beforeEach(async () => {
      google.reset()
      shipbubble.reset()
      await buyer.load()
    })

    describe("suggestions", () => {
      it("suggests places in the cart region's countries, in the buyer's lookup session", async () => {
        const cartId = await newCart()

        const { data } = await suggest(cartId, "Akin Adesola")

        expect(data.suggestions).toEqual([
          { place_id: PLACES.victoriaIsland.id, main_text: "3 Akin Adesola Street", secondary_text: "Victoria Island, Lagos, Nigeria" },
        ])
        expect(google.autocompletes()).toEqual([
          { input: "Akin Adesola", sessionToken: SESSION, includedRegionCodes: ["ng"] },
        ])
      })

      it("are for signed-in buyers only", async () => {
        const cartId = await newCart()

        expect(await status(suggest(cartId, "Akin Adesola", guest()))).toBe(401)
        expect(google.autocompletes()).toEqual([])
      })

      it("look up only from the buyer's own cart", async () => {
        const cartId = await newCart()

        expect(await status(suggest(cartId, "Akin Adesola", buyer.as("bola@oja.test")))).toBe(404)
        expect(google.autocompletes()).toEqual([])
      })

      it("never reach past the region's countries", async () => {
        const cartId = await newCart()

        const { data } = await suggest(cartId, "Oxford Street")

        expect(data.suggestions).toEqual([])
      })
    })

    describe("a place's address", () => {
      it("describes the place in the provider's words, asking Google for the Essentials fields only", async () => {
        const cartId = await newCart()

        const { data } = await details(cartId, PLACES.victoriaIsland.id)

        expect(data.place).toEqual({
          formatted_address: "3 Akin Adesola St, Victoria Island, Lagos 106104, Lagos, Nigeria",
          location: { latitude: 6.4318, longitude: 3.4215 },
          country_code: "NG",
          street: "3 Akin Adesola Street",
          area: "Victoria Island",
          town: "Lagos",
          district: "Eti Osa",
          state: "Lagos",
          postal_code: "106104",
        })
        expect(google.details()).toEqual([
          { placeId: PLACES.victoriaIsland.id, fieldMask: "addressComponents,formattedAddress,location", sessionToken: SESSION },
        ])
      })

      it("has no street for a place known only by its area", async () => {
        const cartId = await newCart()

        const { data } = await details(cartId, PLACES.transAmadi.id)

        expect(data.place).toMatchObject({ street: null, area: "Trans Amadi", district: "Obio/Akpor", state: "Rivers" })
      })

      it("is not found outside the region's countries", async () => {
        const cartId = await newCart()

        expect(await status(details(cartId, PLACES.accra.id))).toBe(404)
      })

      it("is for signed-in buyers with their own cart only", async () => {
        const cartId = await newCart()

        expect(await status(details(cartId, PLACES.victoriaIsland.id, guest()))).toBe(401)
        expect(await status(details(cartId, PLACES.victoriaIsland.id, buyer.as("bola@oja.test")))).toBe(404)
        expect(google.details()).toEqual([])
      })
    })

    describe("the address at the buyer's location", () => {
      it("is the nearest address Google knows there", async () => {
        const cartId = await newCart()

        const { data } = await addressAt(cartId, { latitude: 6.4312, longitude: 3.4209 })

        expect(data.place).toMatchObject({ street: "3 Akin Adesola Street", district: "Eti Osa", state: "Lagos", country_code: "NG" })
        expect(google.reverseGeocodes()).toEqual([{ latlng: "6.4312,3.4209" }])
      })

      it("is none outside the region's countries", async () => {
        const cartId = await newCart()

        const { data } = await addressAt(cartId, PLACES.accra.location)

        expect(data.place).toBeNull()
      })

      it("is none where Google knows no address", async () => {
        const cartId = await newCart()

        const { data } = await addressAt(cartId, { latitude: 0, longitude: 0 })

        expect(data.place).toBeNull()
      })

      it("is for signed-in buyers with their own cart only", async () => {
        const cartId = await newCart()
        const here = PLACES.victoriaIsland.location

        expect(await status(addressAt(cartId, here, guest()))).toBe(401)
        expect(await status(addressAt(cartId, here, buyer.as("bola@oja.test")))).toBe(404)
        expect(google.reverseGeocodes()).toEqual([])
      })
    })

    describe("what shops see of the address", () => {
      /** Ada pays for a cart delivered to her pinned address; the gadget shop's order of it. */
      const pinnedOrder = async () => {
        const cartId = await buyer.adasCart()
        await api.post(`/store/carts/${cartId}/checkout`, { shipping_address: PINNED }, ada())
        const { reference } = await buyer.startPayment(cartId)
        paystack.pay(reference)
        await buyer.postWebhook(paystack.chargeSuccess(reference))
        await buyer.orderGroupOf(cartId)
        return buyer.shopOrderId(GADGETS, cartId)
      }

      it("has the address and the landmark, never the buyer's pin", async () => {
        const orderId = await pinnedOrder()
        const owner = await buyer.owner(GADGETS)

        const { data } = await api.get(`/vendor/orders/${orderId}`, owner)

        expect(data.order.shipping_address).toMatchObject({ address_1: ADDRESS.address_1, city: ADDRESS.city })
        expect(data.order.shipping_address.metadata.landmark).toBe(ADDRESS.metadata.landmark)
        expect(coordinatesIn(data)).toEqual([])
      })

      it("holds whichever fields the shop asks for, in any vendor route", async () => {
        const orderId = await pinnedOrder()
        // Her saved addresses carry pins too.
        await api.post("/store/customers/me/addresses", PINNED, ada())
        const owner = await buyer.owner(GADGETS)
        const fields = "fields=id,shipping_address.*,billing_address.*,shipping_address.metadata,customer.*,customer.addresses.*"

        const responses = await Promise.all([
          api.get(`/vendor/orders/${orderId}?${fields}`, owner),
          api.get(`/vendor/orders?${fields}`, owner),
          api.get(`/vendor/customers?fields=*addresses`, owner),
        ])

        // The pin is there to leak: the buyer's own view of the order has it.
        const { data: mine } = await api.get(`/store/orders/${orderId}?fields=shipping_address.metadata`, ada())
        expect(mine.order.shipping_address.metadata).toMatchObject(PIN)
        const { data: me } = await api.get("/store/customers/me?fields=*addresses", ada())
        expect(me.customer.addresses[0].metadata).toMatchObject(PIN)
        for (const { data } of responses) expect(coordinatesIn(data)).toEqual([])
      })
    })
  },
})
