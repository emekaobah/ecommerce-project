import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { seedDemoWorld } from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_SELLERS } from "../../src/scripts/seed-data"
import { vendorHeaders } from "../helpers/auth"
import { fakeGoogle, PLACES } from "../helpers/google"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

// A port per test process, so the fakes can be named in the config before they listen.
const paystack = fakePaystack(58000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(59000 + (process.pid % 1000))
const google = fakeGoogle(60000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which reads them when registering the providers.
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl
process.env.GOOGLE_MAPS_API_KEY = google.apiKey
process.env.GOOGLE_PLACES_API_URL = google.placesUrl
process.env.GOOGLE_GEOCODING_API_URL = google.geocodingUrl

const SESSION = "0b8a5c1e-7c2f-4f0e-9a51-3d6f1c2b9e44"
const SHOP = SEED_SELLERS[0]

// A shop's owner finds its pickup address with Google's help in the vendor panel, through the
// backend (ADR 0002, #41). Lookups stay in the countries of the shop's region.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let owner: { headers: Record<string, string> }
    let staff: { headers: Record<string, string> }
    const nobody = { headers: {} }

    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )
    const suggest = (input: string, as: object = owner) =>
      api.get(`/vendor/address-lookup/suggestions?session_token=${SESSION}&input=${encodeURIComponent(input)}`, as)
    const details = (placeId: string, as: object = owner) =>
      api.get(`/vendor/address-lookup/places/${placeId}?session_token=${SESSION}`, as)
    const addressAt = ({ latitude, longitude }: { latitude: number; longitude: number }, as: object = owner) =>
      api.get(`/vendor/address-lookup/reverse-geocode?latitude=${latitude}&longitude=${longitude}`, as)

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start(), google.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop(), google.stop()]))
    beforeEach(async () => {
      google.reset()
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { email: SHOP.owner.email } })
      owner = await vendorHeaders(api, SHOP.owner.email, SEED_PASSWORD, seller.id)
      staff = await vendorHeaders(api, SHOP.staff.email, SEED_PASSWORD, seller.id)
    })

    describe("suggestions", () => {
      it("suggests places in the shop region's countries, in the owner's lookup session", async () => {
        const { data } = await suggest("Akin Adesola")

        expect(data.suggestions).toEqual([
          { place_id: PLACES.victoriaIsland.id, main_text: "3 Akin Adesola Street", secondary_text: "Victoria Island, Lagos, Nigeria" },
        ])
        expect(google.autocompletes()).toEqual([
          { input: "Akin Adesola", sessionToken: SESSION, includedRegionCodes: ["ng"] },
        ])
      })

      it("never reach past the shop region's countries", async () => {
        const { data } = await suggest("Oxford Street")

        expect(data.suggestions).toEqual([])
      })

      it("are for members who enter the shop's address only", async () => {
        expect(await status(suggest("Akin Adesola", nobody))).toBe(401)
        expect(await status(suggest("Akin Adesola", staff))).toBe(403)
        expect(google.autocompletes()).toEqual([])
      })
    })

    describe("a place's address", () => {
      it("describes the place in the provider's words", async () => {
        const { data } = await details(PLACES.victoriaIsland.id)

        expect(data.place).toMatchObject({
          location: { latitude: 6.4318, longitude: 3.4215 },
          country_code: "NG",
          street: "3 Akin Adesola Street",
          district: "Eti Osa",
          state: "Lagos",
        })
        expect(google.details()).toEqual([
          { placeId: PLACES.victoriaIsland.id, fieldMask: "addressComponents,formattedAddress,location", sessionToken: SESSION },
        ])
      })

      it("is not found outside the shop region's countries", async () => {
        const res = await details(PLACES.accra.id).catch((e) => e.response)

        expect(res.status).toBe(404)
        expect(res.data.message).toMatch(/don't deliver/)
      })

      it("is for members who enter the shop's address only", async () => {
        expect(await status(details(PLACES.victoriaIsland.id, nobody))).toBe(401)
        expect(await status(details(PLACES.victoriaIsland.id, staff))).toBe(403)
        expect(google.details()).toEqual([])
      })
    })

    describe("the address at the owner's location", () => {
      it("is the nearest address Google knows there", async () => {
        const { data } = await addressAt({ latitude: 6.4312, longitude: 3.4209 })

        expect(data.place).toMatchObject({ street: "3 Akin Adesola Street", state: "Lagos", country_code: "NG" })
        expect(google.reverseGeocodes()).toEqual([{ latlng: "6.4312,3.4209" }])
      })

      it("is none outside the shop region's countries", async () => {
        const { data } = await addressAt(PLACES.accra.location)

        expect(data.place).toBeNull()
      })

      it("is for members who enter the shop's address only", async () => {
        const here = PLACES.victoriaIsland.location

        expect(await status(addressAt(here, nobody))).toBe(401)
        expect(await status(addressAt(here, staff))).toBe(403)
        expect(google.reverseGeocodes()).toEqual([])
      })
    })
  },
})
