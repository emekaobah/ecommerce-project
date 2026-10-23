import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { catalogueSource } from "../../src/lib/enrichment/catalogue"
import { enrichmentService, queueEnrichment } from "../../src/lib/enrichment"
import { seedDemoWorld } from "../../src/scripts/seed"
import { adminHeaders } from "../helpers/auth"
import { offerOn } from "../helpers/offers"
import { claudeDraftSource } from "../../src/lib/enrichment/ai-draft"
import { enrichmentOf, fakeClaude, fakeImageHosts, fakeSource, useSources } from "../helpers/enrichment"

jest.setTimeout(5 * 60 * 1000)

const RICE_EAN = "5901234123457"

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let admin: { headers: Record<string, string> }

    beforeAll(async () => {
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })

    beforeEach(async () => {
      admin = await adminHeaders(getContainer(), api)
      fakeImageHosts(["images.test", "sheet.test"])
    })

    afterEach(() => {
      jest.restoreAllMocks()
      useSources(getContainer(), [])
    })

    /** Imports a sheet whose columns are named after the fields they map to, and returns the created product ids. */
    const importSheet = async (header: string[], ...rows: string[][]) => {
      const csv = [header, ...rows].map((cells) => cells.map((c) => `"${c}"`).join(",")).join("\n")
      const mapping = Object.fromEntries(header.map((h) => [h, h]))
      const { data } = await api.post("/admin/catalogue-import", { csv, source: "Test supplier", mapping }, admin)
      expect(data.results.filter((r: any) => r.status !== "created")).toEqual([])
      return data.results.map((r: any) => r.product_id as string)
    }

    /** The seeded Storage attribute (required for groceries), as a sheet column and a cell. */
    const storageColumn = async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "product_attribute",
        fields: ["id"],
        filters: { handle: "storage", product_id: null } as any,
      })
      return `attribute:${data[0].id}`
    }

    const categoryId = async (name: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity: "product_category", fields: ["id"], filters: { name } })
      return data[0].id as string
    }
    const storeHeaders = async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [key] } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
      return { "x-publishable-api-key": key.token }
    }
    const regionId = async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [region] } = await query.graph({ entity: "region", fields: ["id"] })
      return region.id as string
    }

    const product = async (id: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "product",
        fields: ["id", "title", "description", "weight", "status", "thumbnail", "images.url", "categories.name"],
        filters: { id },
      })
      return data[0] as any
    }

    describe("approval", () => {
      /** A database that knows the rice by barcode, with an image and a category name the catalogue has. */
      const riceDb = (id: string) =>
        fakeSource(id, {
          [RICE_EAN]: {
            url: `https://${id}.test/rice`,
            fields: { image_urls: ["https://images.test/rice.png"], category_names: ["rices", "cereals"] },
          },
        })

      it("publishes an operator's import once enrichment completes it, before any shop prices it", async () => {
        useSources(getContainer(), [{ trusted: true, source: riceDb("curated_db") }])

        const [id] = await importSheet(
          ["title", "barcode", "selling_price", await storageColumn()],
          ["Abakaliki Rice 5kg", RICE_EAN, "14500", "Cool, dry place"]
        )
        const enrichment = await enrichmentOf(api, admin, id)

        expect(enrichment).toMatchObject({
          status: "done",
          outcome: "published",
          reasons: { items: ["Every field came from the operator's sheet or a trusted source, and it is complete."] },
        })
        // "rices" found the catalogue's "Rice & Grains", whose shipping defaults filled the weight.
        expect(await product(id)).toMatchObject({ status: "published", categories: [{ name: "Rice & Grains" }] })
        // Shops can now find it to offer; buyers see nothing until one prices it.
        const { data } = await api.get(`/store/listings?region_id=${await regionId()}&limit=100`, { headers: await storeHeaders() })
        expect(data.listings.some((l: any) => l.product.id === id)).toBe(false)
      })

      it("sends a product to review when a field came from an untrusted source", async () => {
        useSources(getContainer(), [{ trusted: false, source: riceDb("crowd_db") }])

        const [id] = await importSheet(
          ["title", "barcode", "selling_price", await storageColumn()],
          ["Abakaliki Rice 5kg", RICE_EAN, "14500", "Cool, dry place"]
        )
        const enrichment = await enrichmentOf(api, admin, id)

        expect(enrichment.outcome).toBe("needs_review")
        expect(enrichment.reasons.items).toEqual([
          "Images came from crowd db, which isn't trusted.",
          "Category came from crowd db, which isn't trusted.",
        ])
        // Mercur's queue of products awaiting an operator's review.
        expect((await product(id)).status).toBe("proposed")
      })

      it("sends a shop's proposal to review unless a trusted source itself supplied its image and category", async () => {
        useSources(getContainer(), [
          { trusted: true, source: fakeSource("curated_db", { [RICE_EAN]: { url: null, fields: { description: "Local rice" } } }) },
        ])
        const { data } = await api.post(
          "/admin/products",
          {
            title: "Abakaliki Rice 5kg",
            status: "draft",
            images: [{ url: "https://sheet.test/rice.png" }],
            categories: [{ id: await categoryId("Rice & Grains") }],
            variants: [{ title: "Abakaliki Rice 5kg", ean: RICE_EAN }],
          },
          admin
        )

        // The shop supplied the image and category; the trusted source only a description.
        await queueEnrichment(getContainer(), [{ product_id: data.product.id, supplied: ["title", "images", "categories"] }], "vendor")
        const enrichment = await enrichmentOf(api, admin, data.product.id)

        expect(enrichment.outcome).toBe("needs_review")
        expect(enrichment.reasons.items).toEqual([
          "A shop proposed it, and no trusted source confirmed it with an image and a category.",
        ])
      })

      it("leaves an approved product that is still incomplete a draft, saying what it lacks", async () => {
        const [id] = await importSheet(
          ["title", "barcode", "selling_price", "category"],
          ["Abakaliki Rice 5kg", RICE_EAN, "14500", "Rice & Grains"]
        )
        const enrichment = await enrichmentOf(api, admin, id)

        expect(enrichment).toMatchObject({ outcome: "incomplete", reasons: { items: ["Missing Image.", "Missing Storage."] } })
        expect((await product(id)).status).toBe("draft")
      })
    })

    describe("AI drafts", () => {
      it("drafts only the fields no source filled, flags them, and sends the product for review", async () => {
        const claude = fakeClaude({
          title: "Mama Gold Rice",
          description: "Stone-free long grain rice.",
          weight_grams: 5100,
          category_id: await categoryId("Oils & Spices"),
        })
        useSources(getContainer(), [
          {
            trusted: true,
            source: fakeSource("curated_db", {
              [RICE_EAN]: { url: null, fields: { image_urls: ["https://images.test/rice.png"], category_names: ["rice"] } },
            }),
          },
          { trusted: false, source: claudeDraftSource({ client: claude.client }) },
        ])

        const [id] = await importSheet(
          ["title", "barcode", "selling_price", await storageColumn()],
          ["Abakaliki Rice 5kg", RICE_EAN, "14500", "Cool, dry place"]
        )
        const enrichment = await enrichmentOf(api, admin, id)

        // The sheet's title and the database's category stand; Claude filled the rest from the photo.
        expect(await product(id)).toMatchObject({
          title: "Abakaliki Rice 5kg",
          description: "Stone-free long grain rice.",
          categories: [{ name: "Rice & Grains" }],
          status: "proposed",
        })
        expect(Number((await product(id)).weight)).toBe(5100)
        expect(enrichment.fields).toEqual({
          title: { source: "supplied", url: null },
          images: { source: "curated_db", url: null },
          categories: { source: "curated_db", url: null },
          description: { source: "ai_draft", url: null, drafted: true },
          weight: { source: "ai_draft", url: null, drafted: true },
        })
        expect(enrichment.outcome).toBe("needs_review")
        expect(enrichment.reasons.items).toEqual([
          "Description was drafted by AI; a person must check it.",
          "Weight was drafted by AI; a person must check it.",
        ])
        // Claude saw the photo and was asked only for what was still empty.
        const [request] = claude.requests
        expect(request.messages[0].content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png" } })
        expect(request.messages[0].content[1].text).toContain("Fill in: description, weight_grams")
        expect(request.messages[0].content[1].text).toContain("Abakaliki Rice 5kg")
      })

      it("never auto-approves a draft, even when a deployment marks the AI trusted", async () => {
        const claude = fakeClaude({ title: null, description: "Stone-free long grain rice.", weight_grams: null, category_id: null })
        const fields = { image_urls: ["https://images.test/rice.png"], category_names: ["rice"] }
        useSources(getContainer(), [
          { trusted: true, source: fakeSource("curated_db", { [RICE_EAN]: { url: null, fields } }) },
          { trusted: true, source: claudeDraftSource({ client: claude.client }) },
        ])

        const [id] = await importSheet(
          ["title", "barcode", "selling_price", await storageColumn()],
          ["Abakaliki Rice 5kg", RICE_EAN, "14500", "Cool, dry place"]
        )
        const enrichment = await enrichmentOf(api, admin, id)

        expect(enrichment.outcome).toBe("needs_review")
        expect((await product(id)).status).toBe("proposed")
      })

      it("shows the admin which fields were drafted, on the product and among the products awaiting review", async () => {
        const claude = fakeClaude({ title: null, description: "Stone-free long grain rice.", weight_grams: null, category_id: null })
        useSources(getContainer(), [{ trusted: false, source: claudeDraftSource({ client: claude.client }) }])

        const [id] = await importSheet(["title", "barcode", "selling_price"], ["Abakaliki Rice 5kg", RICE_EAN, "14500"])
        // The product page's widget, where the admin approves it.
        expect((await enrichmentOf(api, admin, id)).fields.description).toEqual({ source: "ai_draft", url: null, drafted: true })

        const { data } = await api.get("/admin/catalogue-enrichment?outcome=needs_review", admin)
        expect(data.enrichments).toEqual([
          expect.objectContaining({
            product: expect.objectContaining({ id }),
            fields: expect.objectContaining({ description: { source: "ai_draft", url: null, drafted: true } }),
          }),
        ])
      })
    })

    describe("admin", () => {
      it("lists what enrichment auto-published, newest first, with where each field came from", async () => {
        const fields = { image_urls: ["https://images.test/rice.png"], category_names: ["rice"] }
        useSources(getContainer(), [
          { trusted: true, source: fakeSource("curated_db", { [RICE_EAN]: { url: "https://curated.test/rice", fields } }) },
        ])
        const [published, incomplete] = await importSheet(
          ["title", "barcode", "selling_price", await storageColumn()],
          ["Abakaliki Rice 5kg", RICE_EAN, "14500", "Cool, dry place"],
          ["Mystery Grain", "0012345678905", "900", ""]
        )
        await enrichmentOf(api, admin, published)
        await enrichmentOf(api, admin, incomplete)

        const { data } = await api.get("/admin/catalogue-enrichment?outcome=published", admin)

        expect(data.count).toBe(1)
        expect(data.enrichments).toEqual([
          expect.objectContaining({
            outcome: "published",
            product: expect.objectContaining({ id: published, title: "Abakaliki Rice 5kg", status: "published" }),
            fields: expect.objectContaining({ images: { source: "curated_db", url: "https://curated.test/rice" } }),
          }),
        ])
        const { data: review } = await api.get("/admin/catalogue-enrichment?outcome=incomplete", admin)
        expect(review.enrichments.map((e: any) => e.product.id)).toEqual([incomplete])
      })
    })

    describe("buyers", () => {
      it("credits a source on the product page only where its licence requires it", async () => {
        const credit = { name: "Open Food Facts", url: "https://world.openfoodfacts.org", license: "ODbL / CC BY-SA" }
        const fields = { image_urls: ["https://images.test/rice.png"], category_names: ["rice"] }
        useSources(getContainer(), [
          { trusted: true, source: fakeSource("credited_db", { [RICE_EAN]: { url: null, fields } }, { attribution: credit }) },
          { trusted: true, source: fakeSource("quiet_db", { "0012345678905": { url: null, fields } }) },
        ])
        const [credited, quiet] = await importSheet(
          ["title", "barcode", "selling_price", await storageColumn()],
          ["Abakaliki Rice 5kg", RICE_EAN, "14500", "Cool, dry place"],
          ["Mama Gold Rice 5kg", "0012345678905", "15000", "Cool, dry place"]
        )
        for (const id of [credited, quiet]) {
          expect((await enrichmentOf(api, admin, id)).outcome).toBe("published")
          await offerOn(getContainer(), api, { id })
        }

        const page = async (productId: string) => {
          const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
          const { data: [key] } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
          const { data: [region] } = await query.graph({ entity: "region", fields: ["id"] })
          const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { name: "Iya Bisi Foodstuff" } })
          const { data } = await api.get(`/store/listings/${seller.id}/${productId}?region_id=${region.id}`, {
            headers: { "x-publishable-api-key": key.token },
          })
          return data.listing.product
        }

        expect((await page(credited)).attribution).toEqual([credit])
        expect((await page(quiet)).attribution).toEqual([])
      })
    })

    describe("images", () => {
      it("copies the sheet's images into storage instead of linking to them", async () => {
        const [id] = await importSheet(
          ["title", "barcode", "selling_price", "images"],
          ["Abakaliki Rice 5kg", RICE_EAN, "14500", "https://sheet.test/rice.png"]
        )
        const enrichment = await enrichmentOf(api, admin, id)

        const { images, thumbnail } = await product(id)
        expect(images).toHaveLength(1)
        expect(images[0].url).not.toContain("sheet.test")
        expect(thumbnail).toBe(images[0].url)
        expect(enrichment.fields.images).toEqual({ source: "supplied", url: null })
        expect(enrichment.images.items).toEqual([
          { url: images[0].url, source: "supplied", source_url: "https://sheet.test/rice.png" },
        ])
      })

      it("drops a sheet image it can't copy rather than link to it, saying why", async () => {
        const [id] = await importSheet(
          ["title", "barcode", "selling_price", "images"],
          ["Abakaliki Rice 5kg", RICE_EAN, "14500", "https://sheet.test/missing.png"]
        )
        const enrichment = await enrichmentOf(api, admin, id)

        expect(await product(id)).toMatchObject({ images: [], thumbnail: null })
        expect(enrichment.fields).not.toHaveProperty("images")
        expect(enrichment.errors.items).toEqual(["Image https://sheet.test/missing.png: https://sheet.test/missing.png answered 404"])
      })

      it("skips a source without image rights, taking the image from the next source that has them", async () => {
        useSources(getContainer(), [
          {
            trusted: true,
            source: fakeSource(
              "no_rights_db",
              { [RICE_EAN]: { url: null, fields: { image_urls: ["https://images.test/licensed.png"] } } },
              { image_rights: false }
            ),
          },
          {
            trusted: true,
            source: fakeSource("open_db", {
              [RICE_EAN]: { url: "https://open.test/rice", fields: { image_urls: ["https://images.test/open.png"] } },
            }),
          },
        ])

        const [id] = await importSheet(["title", "barcode", "selling_price"], ["Abakaliki Rice 5kg", RICE_EAN, "14500"])
        const enrichment = await enrichmentOf(api, admin, id)

        const { images } = await product(id)
        expect(images.map((i: any) => i.url)).toEqual([enrichment.images.items[0].url])
        expect(enrichment.images.items).toEqual([
          { url: expect.not.stringContaining("images.test"), source: "open_db", source_url: "https://images.test/open.png" },
        ])
        expect(enrichment.fields.images).toEqual({ source: "open_db", url: "https://open.test/rice" })
      })
    })

    describe("filling fields", () => {
      it("fills only empty fields, each from the highest source that has it, recording where each came from", async () => {
        useSources(getContainer(), [
          {
            trusted: true,
            source: fakeSource("first_db", {
              [RICE_EAN]: { url: "https://first.test/rice", fields: { title: "Mama Gold Rice", description: "Long grain rice" } },
            }),
          },
          {
            trusted: true,
            source: fakeSource("second_db", {
              [RICE_EAN]: { url: "https://second.test/rice", fields: { description: "Parboiled rice", weight: 5000 } },
            }),
          },
        ])

        const [id] = await importSheet(["title", "barcode", "selling_price"], ["Abakaliki Rice 5kg", RICE_EAN, "14500"])
        const enrichment = await enrichmentOf(api, admin, id)

        // The sheet's title stands; the first source's description beats the second's.
        expect(await product(id)).toMatchObject({ title: "Abakaliki Rice 5kg", description: "Long grain rice" })
        expect(Number((await product(id)).weight)).toBe(5000)
        expect(enrichment.fields).toEqual({
          title: { source: "supplied", url: null },
          description: { source: "first_db", url: "https://first.test/rice" },
          weight: { source: "second_db", url: "https://second.test/rice" },
        })
      })

      it("names a row that had only a barcode from the first source that knows it", async () => {
        useSources(getContainer(), [
          {
            trusted: true,
            source: fakeSource("names_db", { [RICE_EAN]: { url: null, fields: { title: "Mama Gold Rice 5kg" } } }),
          },
        ])

        const [id] = await importSheet(["barcode", "selling_price"], [RICE_EAN, "14500"])
        const enrichment = await enrichmentOf(api, admin, id)

        expect((await product(id)).title).toBe("Mama Gold Rice 5kg")
        expect(enrichment.fields.title).toEqual({ source: "names_db", url: null })
      })

      it("records a source that fails to answer and carries on with the next", async () => {
        const down = fakeSource("down_db", {})
        down.lookup = async () => {
          throw new Error("answered 503")
        }
        useSources(getContainer(), [
          { trusted: true, source: down },
          {
            trusted: true,
            source: fakeSource("up_db", { [RICE_EAN]: { url: null, fields: { description: "Local rice" } } }),
          },
        ])

        const [id] = await importSheet(["title", "barcode", "selling_price"], ["Abakaliki Rice 5kg", RICE_EAN, "14500"])
        const enrichment = await enrichmentOf(api, admin, id)

        expect(enrichment.errors.items).toEqual(["down db: answered 503"])
        expect((await product(id)).description).toBe("Local rice")
      })

      it("finds a published catalogue product by its barcode", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [kaftan] } = await query.graph({
          entity: "product",
          fields: ["id", "description", "variants.id"],
          filters: { handle: "adire-kaftan" },
        })
        await getContainer().resolve(Modules.PRODUCT).updateProductVariants(kaftan.variants[0].id, { ean: RICE_EAN })

        const match = await catalogueSource(getContainer()).lookup({ barcode: RICE_EAN })

        expect(match?.fields).toMatchObject({ title: "Adire Kaftan", description: kaftan.description, category_ids: [expect.any(String)] })
        expect(await catalogueSource(getContainer()).lookup({ barcode: "0000000000000" })).toBeNull()

        // Data the catalogue product itself took from a database keeps that database's credit.
        const credit = { name: "Open Food Facts", url: "https://world.openfoodfacts.org", license: "ODbL / CC BY-SA" }
        await enrichmentService(getContainer()).createProductEnrichments({ product_id: kaftan.id, submitter: "operator", attribution: { items: [credit] } })
        expect((await catalogueSource(getContainer()).lookup({ barcode: RICE_EAN }))?.attribution).toEqual([credit])
      })
    })
  },
})
