import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IFileModuleService } from "@medusajs/framework/types"
import { MercurModules, SellerRole } from "@mercurjs/types"
import { seedDemoWorld } from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_SELLERS } from "../../src/scripts/seed-data"
import { claudeDraftSource } from "../../src/lib/enrichment/ai-draft"
import { adminHeaders, vendorHeaders } from "../helpers/auth"
import { enrichmentOf, fakeClaude, fakeImageHosts, useSources } from "../helpers/enrichment"

jest.setTimeout(5 * 60 * 1000)

// Seeded catalogue barcodes: the power bank, which only the electronics shop sells,
// and the ofada rice, which the grocery shop already sells at ₦14,500.
const POWER_BANK = "2000000000114"
const OFADA = "2000000000015"
// A barcode the catalogue doesn't have.
const KILISHI = "4006381333931"

// The smallest valid PNG, standing in for the photo staff take.
const PHOTO = {
  mime_type: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const [grocery] = SEED_SELLERS

    beforeAll(async () => {
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })

    const sellerId = async (shop = grocery) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { email: shop.owner.email } })
      return seller.id as string
    }
    const owner = async (shop = grocery) => vendorHeaders(api, shop.owner.email, SEED_PASSWORD, await sellerId(shop))
    const staff = async (shop = grocery) => vendorHeaders(api, shop.staff.email, SEED_PASSWORD, await sellerId(shop))

    const memberId = async (email: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [member] } = await query.graph({ entity: "member", fields: ["id"], filters: { email } })
      return member.id as string
    }

    /** The shop's offers on the product a barcode names, as the database holds them. */
    const offersOn = async (barcode: string, shop = grocery) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [variant] } = await query.graph({ entity: "product_variant", fields: ["id"], filters: { barcode } })
      const { data } = await query.graph({
        entity: "offer",
        fields: [
          "id",
          "created_by",
          "metadata",
          "manage_inventory",
          "prices.amount",
          "inventory_items.id",
          "inventory_items.location_levels.stocked_quantity",
        ],
        filters: { variant_id: variant.id, seller_id: await sellerId(shop) },
      })
      return data as any[]
    }

    describe("a barcode the catalogue has", () => {
      it("lets fulfilment staff list it for the shop at their price and stock, recorded as theirs", async () => {
        const { data } = await api.post("/vendor/quick-add", { barcode: POWER_BANK, price: 25000, stock: 6 }, await staff())

        expect(data).toMatchObject({ result: "offered", offer_id: expect.any(String), product_id: expect.any(String) })
        const [offer] = await offersOn(POWER_BANK)
        expect(offer).toMatchObject({
          id: data.offer_id,
          created_by: await memberId(grocery.staff.email),
          metadata: { added_with: "quick_add" },
          manage_inventory: true,
        })
        expect(offer.prices.map((p: any) => Number(p.amount))).toEqual([25000])
        expect(offer.inventory_items.flatMap((i: any) => i.location_levels.map((l: any) => Number(l.stocked_quantity)))).toEqual([6])
      })

      it("adds it once when two phones scan it at the same time", async () => {
        const [first, second] = await Promise.all(
          [25000, 26000].map(async (price) =>
            api.post("/vendor/quick-add", { barcode: POWER_BANK, price }, await staff()).then(
              (r: any) => r.status,
              (e: any) => e.response.status
            )
          )
        )

        expect([first, second].sort()).toEqual([201, 422])
        expect(await offersOn(POWER_BANK)).toHaveLength(1)
      })

      it("shows what the scan found: the catalogue's product, not yet sold by the shop", async () => {
        const { data } = await api.get(`/vendor/quick-add/${POWER_BANK}`, await staff())

        expect(data.lookup).toEqual({
          barcode: POWER_BANK,
          currency_code: "ngn",
          product: expect.objectContaining({ title: "20,000mAh Power Bank", in_review: false }),
          offer: null,
        })
      })
    })

    describe("a product the shop already sells", () => {
      it("shows the shop's offer, and refuses staff a quick-add that would change it", async () => {
        const { data } = await api.get(`/vendor/quick-add/${OFADA}`, await staff())
        expect(data.lookup.offer).toMatchObject({ price: 14500 })

        const refused = await api.post("/vendor/quick-add", { barcode: OFADA, price: 99 }, await staff()).catch((e: any) => e.response)
        expect(refused.status).toBe(422)
        expect(refused.data.message).toBe(
          "Your shop already sells Ofada Rice 5kg. Only owners and managers can change its price or stock, in the web vendor panel."
        )
        // No silent price change, and no second offer.
        const offers = await offersOn(OFADA)
        expect(offers.map((o) => o.prices.map((p: any) => Number(p.amount)))).toEqual([[14500]])
      })

      it("stays out of staff's reach on the vendor offer routes, which owners can use", async () => {
        const [offer] = await offersOn(OFADA)
        const price = { prices: [{ amount: 15000, currency_code: "ngn" }] }

        const crew = await staff()
        const refused = await api.post(`/vendor/offers/${offer.id}`, price, crew).catch((e: any) => e.response)
        expect(refused.status).toBe(403)
        // Nor its stock, nor taking it off sale.
        const [item] = offer.inventory_items
        const stock = { update: [{ inventory_item_id: item?.id, required_quantity: 1 }] }
        const restock = await api.post(`/vendor/offers/${offer.id}/inventory-items/batch`, stock, crew).catch((e: any) => e.response)
        expect(restock.status).toBe(403)
        const removed = await api.delete(`/vendor/offers/${offer.id}`, crew).catch((e: any) => e.response)
        expect(removed.status).toBe(403)

        await api.post(`/vendor/offers/${offer.id}`, price, await owner())
        const [updated] = await offersOn(OFADA)
        expect(updated.prices.map((p: any) => Number(p.amount))).toEqual([15000])
      })

      it("is refused to the owner too: quick-add only adds, so prices change in the web vendor panel", async () => {
        const refused = await api.post("/vendor/quick-add", { barcode: OFADA, price: 99 }, await owner()).catch((e: any) => e.response)
        expect(refused.status).toBe(422)
      })
    })

    describe("a barcode the catalogue doesn't have", () => {
      afterEach(() => {
        jest.restoreAllMocks()
        useSources(getContainer(), [])
      })

      it("proposes the product with the staff member's photo and name, offered by the shop once approved", async () => {
        // The photo is read back from our storage (the local file provider's URL) when Claude drafts.
        fakeImageHosts(["localhost:9000"])
        const claude = fakeClaude({ title: null, description: "Spicy dried beef strips.", weight_grams: 120, category_id: null })
        useSources(getContainer(), [{ trusted: false, source: claudeDraftSource({ client: claude.client }) }])

        const { data } = await api.post(
          "/vendor/quick-add",
          { barcode: KILISHI, title: "Kilishi 100g", price: 2500, photo: PHOTO },
          await staff()
        )
        expect(data).toMatchObject({ result: "proposed" })

        const admin = await adminHeaders(getContainer(), api)
        const enrichment = await enrichmentOf(api, admin, data.product_id)
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [product] } = await query.graph({
          entity: "product",
          fields: ["title", "status", "description", "thumbnail", "images.url", "variants.barcode", "variants.ean"],
          filters: { id: data.product_id },
        })
        // The uploaded photo is the product's image, kept in storage as uploaded rather than copied again.
        expect(product).toMatchObject({ title: "Kilishi 100g", status: "proposed", description: "Spicy dried beef strips." })
        expect(product.variants).toEqual([expect.objectContaining({ barcode: KILISHI, ean: KILISHI })])
        expect(product.images.map((i: any) => i.url)).toEqual([product.thumbnail])
        expect(product.thumbnail).toMatch(/^http:\/\/localhost:9000\/static\//)
        expect(enrichment.images.items).toEqual([{ url: product.thumbnail, source: "supplied", source_url: product.thumbnail }])
        // Claude saw the photo; what it drafted is flagged, and the proposal waits in the admin queue.
        expect(claude.requests[0].messages[0].content[0]).toMatchObject({ type: "image" })
        expect(enrichment).toMatchObject({ submitter: "vendor", outcome: "needs_review" })
        expect(enrichment.fields).toMatchObject({
          title: { source: "supplied", url: null },
          images: { source: "supplied", url: null },
          description: { source: "ai_draft", url: null, drafted: true },
          weight: { source: "ai_draft", url: null, drafted: true },
        })
        const { data: queue } = await api.get("/admin/catalogue-enrichment?outcome=needs_review", admin)
        expect(queue.enrichments.map((e: any) => e.product.id)).toContain(data.product_id)

        // The shop's offer on it records who added it.
        const [offer] = await offersOn(KILISHI)
        expect(offer).toMatchObject({
          id: data.offer_id,
          created_by: await memberId(grocery.staff.email),
          metadata: { added_with: "quick_add" },
          manage_inventory: false,
        })
        expect(offer.prices.map((p: any) => Number(p.amount))).toEqual([2500])
      })

      it("deletes the stored photo, and proposes nothing, when the quick-add fails after storing it", async () => {
        const files = getContainer().resolve<IFileModuleService>(Modules.FILE)
        const stored = jest.spyOn(files, "createFiles")
        const offers = getContainer().resolve(MercurModules.OFFER) as { createOffers: (...args: unknown[]) => Promise<unknown> }
        jest.spyOn(offers, "createOffers").mockRejectedValueOnce(new Error("offer refused"))

        const failed = await api
          .post("/vendor/quick-add", { barcode: KILISHI, title: "Kilishi 100g", price: 2500, photo: PHOTO }, await staff())
          .catch((e: any) => e.response)

        // The mocked failure is unexpected, so the API reports it as a server error.
        expect(failed.status).toBe(500)
        expect(stored).toHaveBeenCalledTimes(1)
        const [photo] = (await stored.mock.results[0].value) as { id: string }[]
        await expect(files.getAsBuffer(photo.id)).rejects.toThrow()
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: products } = await query.graph({ entity: "product", fields: ["id"], filters: { title: "Kilishi 100g" } })
        expect(products).toEqual([])
      })

      it("needs a photo and the product's name", async () => {
        for (const body of [{ title: "Kilishi 100g" }, { photo: PHOTO }]) {
          const refused = await api.post("/vendor/quick-add", { barcode: KILISHI, price: 2500, ...body }, await staff()).catch((e: any) => e.response)
          expect(refused.status).toBe(400)
          expect(refused.data.message).toBe("The catalogue doesn't have this barcode: add a photo and the product's name.")
        }
      })

      it("says the catalogue doesn't have it, so the app asks for a photo", async () => {
        const { data } = await api.get(`/vendor/quick-add/${KILISHI}`, await staff())
        expect(data.lookup).toMatchObject({ barcode: KILISHI, product: null, offer: null })
      })

      it("waits for review before the same barcode can be quick-added again", async () => {
        fakeImageHosts(["localhost:9000"])
        await api.post("/vendor/quick-add", { barcode: KILISHI, title: "Kilishi 100g", price: 2500, photo: PHOTO }, await staff())

        // The fashion shop's staff scan it while it is still a proposal.
        const fashion = SEED_SELLERS[1]
        const { data } = await api.get(`/vendor/quick-add/${KILISHI}`, await staff(fashion))
        expect(data.lookup.product).toMatchObject({ title: "Kilishi 100g", in_review: true })
        const refused = await api
          .post("/vendor/quick-add", { barcode: KILISHI, price: 2400 }, await staff(fashion))
          .catch((e: any) => e.response)
        expect(refused.status).toBe(400)
        expect(refused.data.message).toBe("Kilishi 100g is still being reviewed for the catalogue. Add it once it is approved.")
      })
    })

    describe("who added an offer", () => {
      it("shows the owner the member who quick-added the shop's offer on a product, for review", async () => {
        const { data } = await api.post("/vendor/quick-add", { barcode: POWER_BANK, price: 25000 }, await staff())

        // As the panel's offer page asks: by product.
        const { data: authors } = await api.get(`/vendor/offer-authors?product_id=${data.product_id}`, await owner())

        expect(authors.offer_authors).toEqual([
          {
            offer_id: data.offer_id,
            // The barcode is the SKU a quick-add gives the offer.
            sku: POWER_BANK,
            added_with: "quick_add",
            added_by: { id: await memberId(grocery.staff.email), name: "Kunle Adeyemi", email: grocery.staff.email },
            added_at: expect.any(String),
          },
        ])
      })

      it("names the member who added any other offer, and never shows another shop's", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [rice] } = await query.graph({ entity: "product", fields: ["id"], filters: { title: "Ofada Rice 5kg" } })

        const { data: authors } = await api.get(`/vendor/offer-authors?product_id=${rice.id}`, await owner())
        expect(authors.offer_authors).toEqual([
          expect.objectContaining({ added_with: null, added_by: expect.objectContaining({ email: grocery.owner.email }) }),
        ])

        const { data: theirs } = await api.get(`/vendor/offer-authors?product_id=${rice.id}`, await owner(SEED_SELLERS[2]))
        expect(theirs.offer_authors).toEqual([])
      })
    })

    describe("a code that isn't a barcode", () => {
      it("is refused rather than looked up", async () => {
        const refused = await api.get("/vendor/quick-add/2000000000115", await staff()).catch((e: any) => e.response)
        expect(refused.status).toBe(400)
        expect(refused.data.message).toBe('Barcode "2000000000115" has a wrong check digit.')
      })
    })

    describe("members who neither create offers nor fulfil orders", () => {
      it("are refused quick-add", async () => {
        // An accounting member: payouts only.
        const container = getContainer()
        const { data: me } = await api.get(`/vendor/sellers/${await sellerId()}/members/me`, await staff())
        const { updateMemberRoleWorkflow } = await import("@mercurjs/core/workflows")
        await updateMemberRoleWorkflow(container).run({ input: { seller_member_id: me.seller_member.id, role_id: SellerRole.ACCOUNTING } })

        const accountant = await staff()
        const lookup = await api.get(`/vendor/quick-add/${POWER_BANK}`, accountant).catch((e: any) => e.response)
        expect(lookup.status).toBe(403)
        const add = await api.post("/vendor/quick-add", { barcode: POWER_BANK, price: 25000 }, accountant).catch((e: any) => e.response)
        expect(add.status).toBe(403)
        expect(await offersOn(POWER_BANK)).toEqual([])
      })
    })
  },
})
