import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MercurModules } from "@mercurjs/types"
import { approveSellerWorkflow } from "@mercurjs/core/workflows"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_PRODUCTS, SEED_SELLERS } from "../../src/scripts/seed-data"
import { vendorHeaders } from "../helpers/auth"
import { accountName, fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

// A port per test process, so the fakes can be named in the config before they listen.
const paystack = fakePaystack(55000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(57000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which reads them when registering the providers.
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

const RICE = SEED_PRODUCTS.find((p) => p.title === "Ofada Rice 5kg")!

/** Where Mama Put's owner placed the pin on the map (ADR 0002, #41). */
const PIN = { latitude: 6.4969, longitude: 3.3537 }
/** Mama Put's pickup address, as the shop's owner fills in the Nigerian form and pins it on the map. */
const PICKUP = {
  first_name: "Funke",
  last_name: "Ade",
  address_1: "7 Bode Thomas Street",
  address_2: null,
  city: "Surulere",
  province: "Lagos",
  country_code: "ng",
  phone: "08031234599",
  metadata: { landmark: "Opposite the bakery", ...PIN },
}
const BANK = { bank_code: "058", account_number: "0123456789" }
const daily = [{ opens: "08:00", closes: "18:00" }]
const HOURS = { mon: daily, tue: daily, wed: daily, thu: daily, fri: daily, sat: daily, sun: [] }

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let store: Record<string, string>
    let regionId: string

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))

    beforeEach(async () => {
      shipbubble.reset()
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: keys } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
      store = { "x-publishable-api-key": keys[0].token }
      const { data: regions } = await query.graph({ entity: "region", fields: ["id"] })
      regionId = regions[0].id
    })

    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    /**
     * A shop that registered in the vendor panel and that Oja approved, selling Ofada rice, before
     * it has done anything else: a pickup address and bank account are still to come.
     */
    const newShop = async () => {
      const email = "mama.put@oja.test"
      const password = "mama-put-password"
      const { data: registered } = await api.post("/auth/member/emailpass/register", { email, password })
      const { data: created } = await api.post(
        "/vendor/sellers",
        { name: "Mama Put Provisions", email, currency_code: "ngn", member_email: email, first_name: "Funke", last_name: "Ade" },
        { headers: { authorization: `Bearer ${registered.token}` } }
      )
      const sellerId = created.seller.id as string
      await approveSellerWorkflow(getContainer()).run({ input: { seller_id: sellerId } })
      const owner = await vendorHeaders(api, email, password, sellerId)

      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [profile] } = await query.graph({
        entity: "shipping_profile",
        fields: ["id"],
        filters: { name: "Marketplace Shipping" },
      })
      const { data: [rice] } = await query.graph({ entity: "product", fields: ["id", "variants.id"], filters: { title: RICE.title } })
      const { data } = await api.post(
        "/vendor/offers",
        {
          sku: "MAMA-PUT-RICE",
          variant_id: rice.variants[0].id,
          shipping_profile_id: profile.id,
          inventory_items: [{ sku: "MAMA-PUT-RICE" }],
          prices: [{ amount: 9000, currency_code: "ngn" }],
        },
        owner
      )
      return { sellerId, owner, productId: rice.id as string, offerId: data.offer.id as string }
    }

    /** What a buyer can see of the shop through the Store API. */
    const seenByBuyers = async ({ sellerId, productId, offerId }: Awaited<ReturnType<typeof newShop>>) => {
      const { data: feed } = await api.get(`/store/listings?region_id=${regionId}&limit=100`, { headers: store })
      const { data: offers } = await api.get(`/store/offers?limit=100`, { headers: store })
      const { data: sellers } = await api.get(`/store/sellers?limit=100`, { headers: store })
      return {
        feed: feed.listings.some((l: any) => l.seller.id === sellerId),
        listing: await status(api.get(`/store/listings/${sellerId}/${productId}?region_id=${regionId}`, { headers: store })),
        shop: await status(api.get(`/store/shops/${sellerId}?region_id=${regionId}`, { headers: store })),
        offers: offers.offers.some((o: any) => o.seller_id === sellerId),
        offer: await status(api.get(`/store/offers/${offerId}`, { headers: store })),
        sellers: sellers.sellers.some((s: any) => s.id === sellerId),
        seller: await status(api.get(`/store/sellers/${sellerId}`, { headers: store })),
      }
    }
    const HIDDEN = { feed: false, listing: 404, shop: 404, offers: false, offer: 404, sellers: false, seller: 404 }
    const SHOWN = { feed: true, listing: 200, shop: 200, offers: true, offer: 200, sellers: true, seller: 200 }

    const onboardingOf = async (headers: unknown) => (await api.get("/vendor/onboarding", headers)).data.onboarding

    describe("the seeded shops", () => {
      it("are live: their pickup addresses validated with Shipbubble and their bank accounts resolved with Paystack", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        for (const shop of SEED_SELLERS) {
          const { data: [seller] } = await query.graph({
            entity: "seller",
            fields: ["id", "address.metadata"],
            filters: { email: shop.owner.email },
          })
          const owner = await vendorHeaders(api, shop.owner.email, SEED_PASSWORD, seller.id)

          const onboarding = await onboardingOf(owner)

          expect(onboarding).toMatchObject({
            is_live: true,
            steps: [
              { key: "pickup_address", is_complete: true },
              { key: "bank_account", is_complete: true },
              { key: "weekly_hours", is_complete: true },
            ],
          })
          expect(onboarding.bank_account.recipient_code).toBeUndefined()
          // Validated by the pin the seed placed (ADR 0002).
          expect(seller.address.metadata.shipbubble_address_code).toBe(
            shipbubble.codeOf(`${shop.pickup.latitude},${shop.pickup.longitude}`)
          )
        }
        expect(paystack.recipients().map((r) => r.name)).toEqual(
          SEED_SELLERS.map((s) => s.bank.account_number).map((n) => expect.stringContaining(n.slice(-4)))
        )
        const { data } = await api.get(`/store/listings?region_id=${regionId}&limit=100`, { headers: store })
        expect(new Set(data.listings.map((l: any) => l.seller.name))).toEqual(new Set(SEED_SELLERS.map((s) => s.name)))
      })
    })

    describe("store routes", () => {
      it("hide an approved shop that has neither a pickup address nor a bank account", async () => {
        const shop = await newShop()

        expect(await seenByBuyers(shop)).toEqual(HIDDEN)
      })
    })

    describe("the pickup address", () => {
      const savePickup = (shop: { owner: unknown }, address: unknown) =>
        api.post("/vendor/onboarding/pickup-address", address, shop.owner as any)

      it("is validated with Shipbubble by its pin and its address, and completes its step", async () => {
        const shop = await newShop()

        const { data } = await savePickup(shop, PICKUP)

        const [validation] = shipbubble.validations()
        expect(validation).toEqual({
          name: "Mama Put Provisions",
          email: "mama.put@oja.test",
          phone: "+2348031234599",
          address: "7 Bode Thomas Street, Surulere, Lagos, Nigeria",
          ...PIN,
        })
        expect(data.onboarding.steps).toEqual([
          { key: "pickup_address", is_complete: true },
          { key: "bank_account", is_complete: false },
          { key: "weekly_hours", is_complete: false },
        ])
        expect(data.onboarding.pickup_address).toMatchObject({
          address_1: PICKUP.address_1,
          city: "Surulere",
          province: "Lagos",
          phone: "+2348031234599",
          metadata: {
            landmark: "Opposite the bakery",
            ...PIN,
            shipbubble_address_code: shipbubble.codeOf(`${PIN.latitude},${PIN.longitude}`),
          },
        })
        expect(data.onboarding.is_live).toBe(false)
      })

      it("can't be saved without a pin, even entered by hand", async () => {
        const shop = await newShop()

        const res = await savePickup(shop, { ...PICKUP, metadata: { landmark: "Opposite the bakery" } }).catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/pin/i)
        expect(shipbubble.validations()).toEqual([])
        expect((await onboardingOf(shop.owner)).pickup_address).toBeNull()
      })

      // A change's metadata stands for the whole of it (`validatedPickupChange`), so it carries the pin.
      it("can't lose its pin through Mercur's own address route", async () => {
        const shop = await newShop()
        await savePickup(shop, PICKUP)
        shipbubble.reset()

        const res = await api
          .post(`/vendor/sellers/${shop.sellerId}/address`, { metadata: { landmark: "Behind the bakery" } }, shop.owner)
          .catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/pin/i)
        expect(shipbubble.validations()).toEqual([])
        expect((await onboardingOf(shop.owner)).pickup_address.metadata).toMatchObject({ landmark: "Opposite the bakery", ...PIN })
      })

      it("doesn't pass its gate with a Shipbubble code but no pin", async () => {
        const shop = await newShop()
        await savePickup(shop, PICKUP)
        await api.post("/vendor/onboarding/bank-account", BANK, shop.owner)
        // An address validated before pins were required (#41) has its code and no pin.
        const { pickup_address } = await onboardingOf(shop.owner)
        // Medusa merges metadata, and an empty value removes its key.
        const sellers = getContainer().resolve(MercurModules.SELLER) as any
        await sellers.updateSellerAddresses({ id: pickup_address.id, metadata: { latitude: "", longitude: "" } })
        expect((await onboardingOf(shop.owner)).pickup_address.metadata).toEqual({
          landmark: "Opposite the bakery",
          shipbubble_address_code: expect.any(Number),
        })

        const onboarding = await onboardingOf(shop.owner)

        expect(onboarding.steps[0]).toEqual({ key: "pickup_address", is_complete: false })
        expect(onboarding.is_live).toBe(false)
        expect(await seenByBuyers(shop)).toEqual(HIDDEN)
      })

      it("is entered on the form of the shop's country, its region's before it has an address", async () => {
        const shop = await newShop()

        expect((await onboardingOf(shop.owner)).country_code).toBe("ng")
      })

      it("is refused with a clear error when Shipbubble can't place it, and isn't kept", async () => {
        const shop = await newShop()
        shipbubble.rejectAddresses(() => true)

        const res = await savePickup(shop, PICKUP).catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/couldn't find this address/i)
        const onboarding = await onboardingOf(shop.owner)
        expect(onboarding.pickup_address).toBeNull()
        expect(onboarding.steps[0]).toEqual({ key: "pickup_address", is_complete: false })
      })

      it("needs every field the country's form requires, before asking Shipbubble", async () => {
        const shop = await newShop()

        const res = await savePickup(shop, { ...PICKUP, city: "", province: "Atlantis" }).catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toMatch(/LGA/)
        expect(res.data.message).toMatch(/state/)
        expect(shipbubble.validations()).toEqual([])
      })

      it("is validated again when it is changed through Mercur's own address route", async () => {
        const shop = await newShop()
        await savePickup(shop, PICKUP)
        shipbubble.rejectAddresses((v) => v.address.includes("Nowhere"))

        const res = await api
          .post(`/vendor/sellers/${shop.sellerId}/address`, { address_1: "1 Nowhere Close" }, shop.owner)
          .catch((e) => e.response)

        expect(res.status).toBe(400)
        const onboarding = await onboardingOf(shop.owner)
        expect(onboarding.pickup_address.address_1).toBe(PICKUP.address_1)
        expect(onboarding.steps[0].is_complete).toBe(true)
      })

      it("can't be given a Shipbubble code by the shop", async () => {
        const shop = await newShop()
        shipbubble.rejectAddresses(() => true)

        const res = await api
          .post(
            `/vendor/sellers/${shop.sellerId}/address`,
            { ...PICKUP, metadata: { ...PIN, shipbubble_address_code: 12345 } },
            shop.owner
          )
          .catch((e) => e.response)

        expect(res.status).toBe(400)
        expect((await onboardingOf(shop.owner)).steps[0].is_complete).toBe(false)
      })
    })

    describe("the bank account", () => {
      const saveBank = (shop: { owner: unknown }, account: unknown) =>
        api.post("/vendor/onboarding/bank-account", account, shop.owner as any)

      it("lists the banks Paystack pays into", async () => {
        const shop = await newShop()

        const { data } = await api.get("/vendor/onboarding/banks", shop.owner)

        expect(data.banks).toContainEqual({ code: "058", name: "Guaranty Trust Bank" })
      })

      it("is resolved with Paystack to its holder's name, registered as a transfer recipient, and completes its step", async () => {
        const shop = await newShop()

        const { data } = await saveBank(shop, BANK)

        expect(data.onboarding.bank_account).toEqual({
          bank_code: "058",
          bank_name: "Guaranty Trust Bank",
          account_number: BANK.account_number,
          account_name: accountName(BANK.account_number),
        })
        expect(data.onboarding.steps[1]).toEqual({ key: "bank_account", is_complete: true })
        expect(paystack.recipients().at(-1)).toMatchObject({
          type: "nuban",
          name: accountName(BANK.account_number),
          currency: "NGN",
          details: { account_number: BANK.account_number, bank_code: "058" },
        })
      })

      it("is refused with a clear error when Paystack can't resolve it, keeping the shop's account", async () => {
        const shop = await newShop()
        await saveBank(shop, BANK)
        paystack.unknownAccount("0999999999")

        const res = await saveBank(shop, { bank_code: "058", account_number: "0999999999" }).catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toBe(
          "We couldn't find account 0999999999 at Guaranty Trust Bank. Check the account number and the bank."
        )
        expect((await onboardingOf(shop.owner)).bank_account.account_number).toBe(BANK.account_number)
      })

      it("is refused for a bank Paystack doesn't list", async () => {
        const shop = await newShop()

        const res = await saveBank(shop, { bank_code: "999", account_number: BANK.account_number }).catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.message).toBe("Choose your bank from the list")
        expect((await onboardingOf(shop.owner)).steps[1].is_complete).toBe(false)
      })
    })

    describe("going live", () => {
      it("shows the shop's offers on every store route once every gate is complete, and not before", async () => {
        const shop = await newShop()

        await api.post("/vendor/onboarding/pickup-address", PICKUP, shop.owner)
        expect(await seenByBuyers(shop)).toEqual(HIDDEN)

        await api.post("/vendor/onboarding/bank-account", BANK, shop.owner)
        // Without weekly opening hours a shop isn't live (ADR 0004).
        expect(await seenByBuyers(shop)).toEqual(HIDDEN)
        expect(await onboardingOf(shop.owner)).toMatchObject({
          is_live: false,
          steps: [
            { key: "pickup_address", is_complete: true },
            { key: "bank_account", is_complete: true },
            { key: "weekly_hours", is_complete: false },
          ],
        })

        await api.post("/vendor/shop-hours/weekly", { weekly: HOURS }, shop.owner)
        expect(await seenByBuyers(shop)).toEqual(SHOWN)
        expect((await onboardingOf(shop.owner)).is_live).toBe(true)
      })

      it("shows a shop with only its bank account no offers", async () => {
        const shop = await newShop()

        await api.post("/vendor/onboarding/bank-account", BANK, shop.owner)

        expect(await seenByBuyers(shop)).toEqual(HIDDEN)
      })

      it("keeps a shop that isn't live out of buyers' carts, and out of /store/products' cheapest offer", async () => {
        const shop = await newShop()
        const { data: cart } = await api.post("/store/carts", { region_id: regionId }, { headers: store })

        const res = await api
          .post(`/store/carts/${cart.cart.id}/line-items`, { offer_id: shop.offerId, quantity: 1 }, { headers: store })
          .catch((e) => e.response)
        const { data } = await api.get(
          `/store/products/${shop.productId}?region_id=${regionId}&fields=id,*variants,variants.calculated_price,variants.offer_id`,
          { headers: store }
        )

        expect(res.status).toBe(404)
        // Mama Put sells the rice cheapest, but isn't live.
        expect(data.product.variants[0].offer_id).not.toBe(shop.offerId)
        expect(data.product.variants[0].offer_id).toEqual(expect.any(String))
      })
    })

    describe("who sees and changes it", () => {
      it("shows fulfilment staff the checklist, but only owners and managers change the shop's details", async () => {
        const shop = SEED_SELLERS[0]
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { email: shop.owner.email } })
        const staff = await vendorHeaders(api, shop.staff.email, SEED_PASSWORD, seller.id)

        expect(await status(api.get("/vendor/onboarding", staff))).toBe(200)
        expect(await status(api.get("/vendor/onboarding/banks", staff))).toBe(403)
        expect(await status(api.post("/vendor/onboarding/bank-account", BANK, staff))).toBe(403)
        expect(await status(api.post("/vendor/onboarding/pickup-address", PICKUP, staff))).toBe(403)
      })
    })
  },
})
