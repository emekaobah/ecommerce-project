import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MercurModules, SellerRole } from "@mercurjs/types"
import { updateProductAttributesWorkflow } from "@mercurjs/core/workflows"
import seedDemoData from "../../src/scripts/seed"
import {
  SEED_CATEGORIES,
  SEED_CATEGORY_ATTRIBUTES,
  SEED_PASSWORD,
  SEED_SELLERS,
} from "../../src/scripts/seed-data"
import { getProductsCompleteness } from "../../src/lib/product-completeness"

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
          attributes: await count("product_attribute"),
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

      it("makes every seeded shop live, through onboarding, without Shipbubble or Paystack configured", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        for (const shop of SEED_SELLERS) {
          const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { email: shop.owner.email } })
          const { data: login } = await api.post("/auth/member/emailpass", { email: shop.owner.email, password: SEED_PASSWORD })
          const { data } = await api.get("/vendor/onboarding", {
            headers: { authorization: `Bearer ${login.token}`, "x-seller-id": seller.id },
          })

          expect(data.onboarding).toMatchObject({ is_live: true, status: "open" })
          expect(data.onboarding.bank_account).toMatchObject({ bank_code: shop.bank.bank_code, account_number: shop.bank.account_number })
        }
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

      it("gives each department's categories its starter attributes and shipping defaults", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: categories } = await query.graph({
          entity: "product_category",
          fields: ["id", "name", "metadata"],
        })
        const { data: attributes } = await query.graph({
          entity: "product_attribute",
          fields: ["id", "handle", "is_required", "categories.id"],
          filters: { product_id: null } as any,
        })
        const attributeHandlesFor = (categoryId: string) =>
          (attributes as any[])
            .filter((a) => (a.categories ?? []).some((c: any) => c?.id === categoryId))
            .map((a) => a.handle)
            .sort()

        for (const [department, subcategories] of Object.entries(SEED_CATEGORIES)) {
          const starter = SEED_CATEGORY_ATTRIBUTES[department as keyof typeof SEED_CATEGORIES]
          expect(starter.length).toBeGreaterThan(0)
          for (const name of [department, ...subcategories]) {
            const category = (categories as any[]).find((c) => c.name === name)
            expect(attributeHandlesFor(category.id)).toEqual(starter.map((a) => a.handle).sort())
            expect(category.metadata?.shipping_defaults).toEqual(
              expect.objectContaining({
                weight: expect.any(Number),
                length: expect.any(Number),
                width: expect.any(Number),
                height: expect.any(Number),
                package_category: expect.any(String),
              })
            )
          }
        }

        const byHandle = new Map((attributes as any[]).map((a) => [a.handle, a]))
        expect(byHandle.get("fabric")?.is_required).toBe(true)
        expect(byHandle.get("voltage")?.is_required).toBe(true)
        expect(byHandle.has("care-instructions")).toBe(true)
      })

      it("publishes every seeded product complete, with its dimensions from the category defaults", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["id", "status", "length", "width", "height"],
        })
        const completeness = await getProductsCompleteness(
          getContainer(),
          products.map((p: any) => p.id)
        )
        for (const product of products as any[]) {
          expect(product.status).toBe("published")
          expect(Number(product.length)).toBeGreaterThan(0)
          expect(Number(product.width)).toBeGreaterThan(0)
          expect(Number(product.height)).toBeGreaterThan(0)
        }
        expect(completeness.filter((c) => !c.is_complete)).toEqual([])
      })

      it("brings an existing starter attribute's required flag and category links back in line on re-run", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const load = async () =>
          (
            await query.graph({
              entity: "product_attribute",
              fields: ["id", "is_required", "categories.id"],
              filters: { handle: "fabric", product_id: null } as any,
            })
          ).data[0] as any
        const before = await load()
        const linked = (before.categories as { id: string }[]).map((c) => c.id).sort()
        const { data: [groceries] } = await query.graph({
          entity: "product_category",
          fields: ["id"],
          filters: { name: "Groceries" },
        })

        // Drift the attribute: optional, one category link lost, one stray link added.
        await updateProductAttributesWorkflow(getContainer()).run({
          input: { selector: { id: before.id }, update: { is_required: false } },
        })
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK)
        const pair = (categoryId: string) => ({
          [MercurModules.PRODUCT_ATTRIBUTE]: { product_attribute_id: before.id },
          [Modules.PRODUCT]: { product_category_id: categoryId },
        })
        await link.dismiss(pair(linked[0]))
        await link.create(pair(groceries.id))

        await seed()

        const after = await load()
        expect(after.is_required).toBe(true)
        expect((after.categories as { id: string }[]).map((c) => c.id).sort()).toEqual(linked)
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
