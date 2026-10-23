import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MercurModules, SellerRole } from "@mercurjs/types"
import { updateProductAttributesWorkflow, updateSellersWorkflow } from "@mercurjs/core/workflows"
import { createCustomersWorkflow, updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import seedDemoData from "../../src/scripts/seed"
import {
  SEED_CATEGORIES,
  SEED_CATEGORY_ATTRIBUTES,
  SEED_PASSWORD,
  DEMO_BUYER_EMAIL,
  SEED_PRODUCTS,
  SEED_REVIEWED_ORDERS,
  SEED_REVIEWERS,
  SEED_SELLERS,
} from "../../src/scripts/seed-data"
import {
  applyDemoImages,
  areStoredCopies,
  isStoredCopy,
  productPhotoFiles,
  shopImageFiles,
} from "../../src/scripts/demo-images"
import { applyDemoReviews, reviewsOn } from "../../src/scripts/demo-reviews"
import { getProductsCompleteness } from "../../src/lib/product-completeness"
import { buyerReviewCounts, buyerReviews } from "../../src/lib/reviews"
import { fulfilmentService } from "../../src/lib/order-fulfilment"

jest.setTimeout(5 * 60 * 1000)

const galleryOf = (product: { images: { url: string; rank: number }[] }) =>
  [...product.images].sort((a, b) => a.rank - b.rank).map((i) => i.url)

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
          customers: await count("customer"),
          orders: await count("order"),
          reviews: await count("review"),
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

      it("gives the fashion shop a collection point at its pickup address, so pickup works in dev (#12)", async () => {
        const fashion = SEED_SELLERS.find((s) => s.collection_point)!
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { email: fashion.owner.email } })
        const { data: login } = await api.post("/auth/member/emailpass", { email: fashion.owner.email, password: SEED_PASSWORD })

        const { data } = await api.get("/vendor/collection-point", {
          headers: { authorization: `Bearer ${login.token}`, "x-seller-id": seller.id },
        })

        expect(fashion.department).toBe("Fashion")
        expect(data.collection_point).toMatchObject({
          follows_pickup_address: true,
          address: { address_1: fashion.pickup.address_1 },
          instructions: fashion.collection_point!.instructions,
        })
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

      it("seeds a categorised catalogue with its demo photos and weights in grams", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["id", "title", "thumbnail", "weight", "images.url", "images.rank", "categories.id"],
        })
        expect(products).toHaveLength(SEED_PRODUCTS.length)
        for (const product of products as any[]) {
          const files = productPhotoFiles(SEED_PRODUCTS.find((p) => p.title === product.title)!)
          expect(isStoredCopy(product.thumbnail, files[0])).toBe(true)
          expect(areStoredCopies(galleryOf(product), files)).toBe(true)
          expect(product.categories.length).toBeGreaterThan(0)
          expect(Number(product.weight)).toBeGreaterThan(0)
        }
      })

      it("gives every shop its demo logo and banner", async () => {
        const { data: sellers } = await getContainer()
          .resolve(ContainerRegistrationKeys.QUERY)
          .graph({ entity: "seller", fields: ["name", "logo", "banner"] })
        for (const seller of sellers as any[]) {
          const { logo, banner } = shopImageFiles(seller.name)
          expect([isStoredCopy(seller.logo, logo), isStoredCopy(seller.banner, banner)]).toEqual([true, true])
        }
      })

      it("puts the demo photos back on an older database's products and shops, and only once", async () => {
        const container = getContainer()
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const productOf = async (title: string) =>
          (
            await query.graph({
              entity: "product",
              fields: ["id", "thumbnail", "images.url", "images.rank", "variants.id", "variants.sku"],
              filters: { title },
            })
          ).data[0] as any
        const sellerOf = async (name: string) =>
          (await query.graph({ entity: "seller", fields: ["id", "logo", "banner"], filters: { name } })).data[0] as any

        // As an older seed left them: a placeholder pack shot and an avatar service's logo.
        const rice = await productOf("Ofada Rice 5kg")
        const placeholder = "https://placehold.co/800x800/png?text=Ofada+Rice"
        await updateProductsWorkflow(container).run({
          input: { selector: { id: rice.id }, update: { thumbnail: placeholder, images: [{ url: placeholder }] } },
        })
        const shop = await sellerOf("Adire House")
        await updateSellersWorkflow(container).run({
          input: { selector: { id: shop.id }, update: { logo: "https://api.dicebear.com/x.svg" } },
        })

        const applied = await applyDemoImages(container)
        expect(applied.products).toEqual({ updated: 1, current: SEED_PRODUCTS.length - 1, missing: [] })
        expect(applied.sellers).toEqual({ updated: 1, current: SEED_SELLERS.length - 1, missing: [] })

        const fixed = await productOf("Ofada Rice 5kg")
        const files = productPhotoFiles(SEED_PRODUCTS.find((p) => p.title === "Ofada Rice 5kg")!)
        expect(isStoredCopy(fixed.thumbnail, files[0])).toBe(true)
        expect(areStoredCopies(galleryOf(fixed), files)).toBe(true)
        expect(fixed.variants).toEqual(rice.variants)
        const fixedShop = await sellerOf("Adire House")
        expect(isStoredCopy(fixedShop.logo, shopImageFiles("Adire House").logo)).toBe(true)
        expect(isStoredCopy(fixedShop.banner, shopImageFiles("Adire House").banner)).toBe(true)

        // A second run finds everything current and uploads nothing.
        const again = await applyDemoImages(container)
        expect(again.products.updated + again.sellers.updated).toBe(0)
        expect(await productOf("Ofada Rice 5kg")).toEqual(fixed)
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

      /** The seed data's reviews, newest first, as other buyers see them: the demo buyer's wait until they sign in. */
      const seededReviews = (buyers: (email: string) => boolean = (email) => email !== DEMO_BUYER_EMAIL) =>
        SEED_REVIEWED_ORDERS.filter((order) => buyers(order.buyer))
          .sort((a, b) => a.days_ago - b.days_ago)
          .flatMap((order) => reviewsOn(order).map((named) => ({ ...named, buyer: order.buyer })))
      const shown = (reviews: ReturnType<typeof seededReviews>) =>
        reviews
          .filter((r) => r.review.status === "published")
          .map(({ buyer, review }) => {
            const { first_name, last_name } = SEED_REVIEWERS.find((p) => p.email === buyer)!
            return [`${first_name} ${last_name[0]}.`, review.rating, review.text ?? null, review.reply ?? null]
          })
      const average = (rows: unknown[][]) => (rows.length ? rows.reduce((sum, r) => sum + (r[1] as number), 0) / rows.length : null)
      const storeHeaders = async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: keys } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
        return { "x-publishable-api-key": keys[0].token as string }
      }

      it("seeds demo buyers' reviews of the shops and products they received: the published ones show, with the shops' replies", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const headers = await storeHeaders()
        const reviews = seededReviews()

        for (const shop of SEED_SELLERS) {
          const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { name: shop.name } })
          const { data } = await api.get(`/store/sellers/${seller.id}/reviews?limit=50`, { headers })
          const expected = shown(reviews.filter((r) => r.reference === "seller" && r.shop === shop.name))

          expect(data.reviews.map((r: any) => [r.author, r.rating, r.customer_note, r.seller_note])).toEqual(expected)
          expect([shop.name, data.count, data.average_rating]).toEqual([shop.name, expected.length, average(expected)])
        }
        for (const product of SEED_PRODUCTS) {
          const { data: [row] } = await query.graph({ entity: "product", fields: ["id"], filters: { title: product.title } })
          const { data } = await api.get(`/store/products/${row.id}/reviews?limit=50`, { headers })
          const expected = shown(reviews.filter((r) => r.reference === "product" && r.product === product.title))

          expect([product.title, data.reviews.map((r: any) => [r.author, r.rating, r.customer_note, r.seller_note])]).toEqual([
            product.title,
            expected,
          ])
        }
        // Dated over the past weeks, as the buyers received their orders.
        const { data: dates } = await query.graph({ entity: "review", fields: ["created_at"] })
        const ages = (dates as { created_at: string }[]).map((r) => (Date.now() - Date.parse(r.created_at)) / 86_400_000)
        expect(Math.max(...ages)).toBeGreaterThan(30)
        expect(Math.min(...ages)).toBeGreaterThan(0)
      })

      it("writes each review on an order its buyer received, which stays out of their order history and is never paid out", async () => {
        const container = getContainer()
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const rows = await fulfilmentService(container).listOrderFulfilments({})
        const { data: links } = await query.graph({ entity: "order", fields: ["id", "seller.id", "customer_id"] })

        expect(rows).toHaveLength(SEED_REVIEWED_ORDERS.filter((o) => o.buyer !== DEMO_BUYER_EMAIL).length)
        for (const row of rows) {
          expect(["delivered", "collected"]).toContain(row.state)
          expect(row).toMatchObject({ phase: "past", order_group_id: null, payout_eligible_at: null })
          const order = (links as any[]).find((o) => o.id === row.order_id)
          expect([order.seller.id, order.customer_id]).toEqual([row.seller_id, row.customer_id])
        }
        const { data: customers } = await query.graph({ entity: "customer", fields: ["id"], filters: { email: SEED_REVIEWERS.map((r) => r.email) } })
        for (const { id } of customers as { id: string }[]) {
          expect((await buyerReviewCounts(container, id)).orders_to_review).toBe(0)
        }
      })

      it("adds the demo buyer's reviews, in each moderation state, once they have signed in, and only once", async () => {
        const container = getContainer()
        const {
          result: [buyer],
        } = await createCustomersWorkflow(container).run({ input: { customersData: [{ email: DEMO_BUYER_EMAIL, has_account: true }] } })
        const theirs = SEED_REVIEWED_ORDERS.filter((o) => o.buyer === DEMO_BUYER_EMAIL)
        const written = theirs.flatMap(reviewsOn)

        const applied = await applyDemoReviews(container)

        expect(applied).toEqual({
          orders: theirs.length,
          reviews: written.length,
          current: SEED_REVIEWED_ORDERS.length - theirs.length,
          waiting: 0,
          missing: [],
        })
        const mine = [...(await buyerReviews(container, buyer.id)).values()]
        expect(mine.map((r) => [r.rating, r.customer_note, r.status]).sort()).toEqual(
          written.map(({ review }) => [review.rating, review.text ?? null, review.status]).sort()
        )
        // The shop's reply shows its author only once their review is published.
        for (const review of mine) if (review.status !== "published") expect(review.seller_note).toBeNull()
        expect(await buyerReviewCounts(container, buyer.id)).toEqual({ reviews_written: written.length, orders_to_review: 0 })

        expect(await applyDemoReviews(container)).toMatchObject({ orders: 0, reviews: 0, current: SEED_REVIEWED_ORDERS.length })
      })

      it("is idempotent on re-run", async () => {
        const before = await counts()
        await seed()
        expect(await counts()).toEqual(before)
      })
    })
  },
})
