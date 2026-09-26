import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MercurModules, SellerRole } from "@mercurjs/types"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_SELLERS } from "../../src/scripts/seed-data"

jest.setTimeout(5 * 60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("Oja demo seed", () => {
      const seed = () => seedDemoData({ container: getContainer(), args: [] } as any)

      const counts = async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const count = async (entity: string) => (await query.graph({ entity, fields: ["id"] })).data.length
        return {
          regions: await count("region"),
          sellers: await count("seller"),
          members: await count("member"),
          products: await count("product"),
          offers: await count("offer"),
          categories: await count("product_category"),
          apiKeys: await count("api_key"),
          salesChannels: await count("sales_channel"),
          stockLocations: await count("stock_location"),
          shippingOptions: await count("shipping_option"),
        }
      }

      // One seed for the suite; the idempotency test seeds again on top.
      beforeAll(async () => {
        await seed()
      })

      it("creates only an NG region priced in NGN, with Nigerian VAT", async () => {
        const regionService = getContainer().resolve(Modules.REGION)
        const regions = await regionService.listRegions({}, { relations: ["countries"] })
        expect(regions).toHaveLength(1)
        expect(regions[0].currency_code).toBe("ngn")
        expect(regions[0].countries!.map((c) => c.iso_2)).toEqual(["ng"])
        expect(regions.some((r) => r.name === "Europe")).toBe(false)

        const taxService = getContainer().resolve(Modules.TAX)
        const rates = await taxService.listTaxRates({ tax_region: { country_code: "ng" }, is_default: true } as any)
        expect(rates.map((r) => r.rate)).toEqual([7.5])

        const store = (await getContainer().resolve(Modules.STORE).listStores({}, { relations: ["supported_currencies"] }))[0]
        expect(store.supported_currencies!.map((c) => c.currency_code)).toEqual(["ngn"])
      })

      it("creates three approved Lagos sellers with a pickup address, an owner and a staff member", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: sellers } = await query.graph({
          entity: "seller",
          fields: ["id", "name", "status", "currency_code", "address.*"],
        })
        expect(sellers).toHaveLength(3)
        expect(sellers.map((s: any) => s.name).sort()).toEqual(SEED_SELLERS.map((s) => s.name).sort())
        expect(sellers.some((s: any) => s.address?.city === "Berlin")).toBe(false)

        const areas = new Set<string>()
        for (const seller of sellers as any[]) {
          expect(seller.status).toBe("open")
          expect(seller.currency_code).toBe("ngn")
          expect(seller.address).toMatchObject({ province: "Lagos", country_code: "ng" })
          expect(seller.address.address_1).toBeTruthy()
          areas.add(seller.address.city)

          const sellerService = getContainer().resolve(MercurModules.SELLER) as any
          const memberships = await sellerService.listSellerMembers({ seller_id: seller.id })
          const owner = memberships.find((m: any) => m.is_owner)
          const staff = memberships.find((m: any) => !m.is_owner)
          expect(owner?.role_id).toBe(SellerRole.SELLER_ADMINISTRATION)
          expect(staff?.role_id).toBe(SellerRole.ORDER_MANAGEMENT)

          const { data: offers } = await query.graph({ entity: "offer", fields: ["id"], filters: { seller_id: seller.id } })
          expect(offers.length).toBeGreaterThan(0)
        }
        expect(areas.size).toBe(3)
      })

      it("lets every seeded owner and staff member log in with the documented password", async () => {
        for (const seller of SEED_SELLERS) {
          for (const email of [seller.owner.email, seller.staff.email]) {
            const res = await api.post("/auth/member/emailpass", { email, password: SEED_PASSWORD })
            expect(res.data.token).toBeTruthy()
          }
        }
      })

      it("sells some products at more than one shop, each at its own price", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: offers } = await query.graph({ entity: "offer", fields: ["id", "variant_id", "seller_id"] })
        const sellersByVariant = new Map<string, Set<string>>()
        for (const offer of offers as any[]) {
          sellersByVariant.set(offer.variant_id, (sellersByVariant.get(offer.variant_id) ?? new Set()).add(offer.seller_id))
        }
        const shared = [...sellersByVariant.entries()].filter(([, sellers]) => sellers.size > 1)
        expect(shared.length).toBeGreaterThan(0)

        const pricing = getContainer().resolve(Modules.PRICING)
        const [variantId] = shared[0]
        const sharedOffers = (offers as any[]).filter((o) => o.variant_id === variantId)
        const amounts = await Promise.all(
          sharedOffers.map(async (o) => {
            const prices = await pricing.listPrices({ price_rules: { attribute: "offer_id", value: o.id } } as any)
            return Number(prices[0].amount)
          })
        )
        expect(new Set(amounts).size).toBe(amounts.length)
      })

      it("seeds a categorised catalogue with images and weights in grams", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["id", "thumbnail", "weight", "images.url", "categories.id"],
        })
        expect(products.length).toBeGreaterThan(0)
        for (const product of products as any[]) {
          expect(product.thumbnail).toBeTruthy()
          expect(product.images.length).toBeGreaterThan(0)
          expect(product.categories.length).toBeGreaterThan(0)
          expect(Number(product.weight)).toBeGreaterThan(0)
        }
      })

      it("serves the catalogue in NGN to the buyer app's publishable key", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: keys } = await query.graph({
          entity: "api_key",
          fields: ["token", "sales_channels.id"],
          filters: { type: "publishable" },
        })
        expect(keys).toHaveLength(1)
        expect(keys[0].sales_channels).toHaveLength(1)

        const headers = { "x-publishable-api-key": keys[0].token }
        const { data: regionData } = await api.get("/store/regions", { headers })
        const region = regionData.regions[0]
        const { data } = await api.get(`/store/products?region_id=${region.id}`, { headers })
        expect(data.products.length).toBeGreaterThan(0)
        expect(data.products[0].variants[0].calculated_price.currency_code).toBe("ngn")
      })

      it("is idempotent on re-run", async () => {
        const before = await counts()
        await seed()
        expect(await counts()).toEqual(before)
      })
    })
  },
})
