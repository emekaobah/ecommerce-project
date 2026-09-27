import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { adminHeaders } from "../helpers/auth"

jest.setTimeout(5 * 60 * 1000)

// A supplier's price list, as spreadsheets export it: barcodes mangled into
// numbers, prices with the naira sign, and weights and sizes with units.
const SUPPLIER_CSV = [
  "Product Name,GTIN,Retail price,Category,Weight,Height,Storage,Image",
  'Yam Flour 1kg,5.901234123457E+12,"₦2,300",Beans & Garri,1kg,25cm,"Cool, dry place",https://placehold.co/800x800/png?text=Yam',
  "Egusi 500g,12345678905,N1800,Oils & Spices,500 g,,Cool dry place,",
  "Plantain Flour,5.90123E+12,1500,Snacks & Drinks,0.5kg,,,",
  ",,900,,,,,",
].join("\n")

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let admin: { headers: Record<string, string> }

    beforeAll(async () => {
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })

    beforeEach(async () => {
      admin = await adminHeaders(getContainer(), api)
    })

    const productsTitled = async (titles: string[]) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "product",
        fields: ["id", "title", "status", "weight", "height", "categories.name", "variants.ean", "variants.metadata"],
        filters: { title: titles },
      })
      return data as any[]
    }

    const refusal = async (request: Promise<unknown>) => {
      const error = await request.then(
        () => {
          throw new Error("expected the request to be refused")
        },
        (e: any) => e
      )
      expect(error.response?.status).toBe(400)
      return error.response.data.message as string
    }

    describe("preview", () => {
      it("suggests a mapping for a new source and reports each row's errors and missing fields", async () => {
        const { data } = await api.post("/admin/catalogue-import/preview", { csv: SUPPLIER_CSV, source: "Ikeja wholesaler" }, admin)

        expect(data.mapping_origin).toBe("suggested")
        expect(data.mapping).toMatchObject({
          "Product Name": "title",
          GTIN: "barcode",
          "Retail price": "selling_price",
          Category: "category",
          Weight: "weight",
          Height: "height",
          Image: "images",
        })
        expect(data.mapping.Storage).toMatch(/^attribute:/)
        expect(data.samples).toMatchObject({ "Product Name": "Yam Flour 1kg", Height: "25cm" })

        const [yam, egusi, plantain, blank] = data.rows
        expect(yam).toMatchObject({ row: 2, title: "Yam Flour 1kg", errors: [] })
        expect(yam.warnings).toEqual([expect.stringContaining("scientific notation")])
        // Only a shop's offer can price a product, so the price stays missing until then.
        expect(yam.missing).toEqual(["Selling price"])

        // "Cool dry place" (no comma) isn't one of Storage's values.
        expect(egusi.errors).toEqual([expect.stringMatching(/^Storage: "Cool dry place" is not one of/)])
        expect(plantain.errors).toEqual([expect.stringMatching(/^GTIN: .*lost digits/)])
        expect(blank.errors).toEqual(["Needs a title or a barcode."])
        expect(data.summary).toEqual({ total: 4, valid: 1, invalid: 3 })

        // A preview creates nothing.
        expect(await productsTitled(["Yam Flour 1kg"])).toHaveLength(0)
      })
    })

    describe("import", () => {
      it("creates the valid rows as draft products through the catalogue's workflows, and none of the invalid ones", async () => {
        const csv = SUPPLIER_CSV.replace("Cool dry place", '"Cool, dry place"')
        const { data } = await api.post(
          "/admin/catalogue-import",
          { csv, source: "Ikeja wholesaler", mapping: (await api.post("/admin/catalogue-import/preview", { csv }, admin)).data.mapping },
          admin
        )

        expect(data.results.map((r: any) => [r.row, r.status])).toEqual([
          [2, "created"],
          [3, "created"],
          [4, "skipped"],
          [5, "skipped"],
        ])
        expect(data.summary).toEqual({ total: 4, created: 2, skipped: 2, failed: 0 })

        const products = await productsTitled(["Yam Flour 1kg", "Egusi 500g", "Plantain Flour"])
        expect(products.map((p) => p.title).sort()).toEqual(["Egusi 500g", "Yam Flour 1kg"])
        const yam = products.find((p) => p.title === "Yam Flour 1kg")
        expect(yam).toMatchObject({ status: "draft", categories: [{ name: "Beans & Garri" }] })
        expect(Number(yam.weight)).toBe(1000)
        expect(Number(yam.height)).toBe(25)
        expect(yam.variants[0].ean).toBe("5901234123457")
        expect(yam.variants[0].metadata.import_price).toEqual({ amount: 2300, currency_code: "ngn" })

        const egusi = products.find((p) => p.title === "Egusi 500g")
        expect(Number(egusi.weight)).toBe(500)
        expect(egusi.variants[0].ean).toBe("0012345678905")
      })

      it("creates an incomplete product as a draft, never published, reporting what it is missing", async () => {
        const csv = [
          "Title,Price,Category",
          "Kilishi 200g,3500,Snacks & Drinks",
        ].join("\n")
        const { data } = await api.post(
          "/admin/catalogue-import",
          { csv, source: "Kano supplier", mapping: { Title: "title", Price: "selling_price", Category: "category" } },
          admin
        )

        expect(data.results).toEqual([
          expect.objectContaining({ row: 2, status: "created", missing: ["Selling price", "Image", "Storage"] }),
        ])
        const [kilishi] = await productsTitled(["Kilishi 200g"])
        expect(kilishi.status).toBe("draft")

        // Created through Mercur's workflow, which records who added it.
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: changes } = await query.graph({
          entity: "product_change",
          fields: ["id", "actions.action"],
          filters: { product_id: kilishi.id } as any,
        })
        expect(changes.flatMap((c: any) => c.actions.map((a: any) => a.action))).toContain("PRODUCT_ADD")

        // The publish gate refuses it for the same reasons the import reported.
        const message = await refusal(api.post(`/admin/products/${kilishi.id}`, { status: "published" }, admin))
        expect(message).toContain("Selling price, Image, Storage")
      })

      it("refuses a mapping that names a column twice or a field that doesn't exist, creating nothing", async () => {
        const message = await refusal(
          api.post(
            "/admin/catalogue-import",
            { csv: "Title,Name,Price\nA,B,1", source: "Bad", mapping: { Title: "title", Name: "title", Price: "selling_price" } },
            admin
          )
        )
        expect(message).toContain("Title is mapped from more than one column")
        expect(await productsTitled(["A", "B"])).toHaveLength(0)
      })

      it("refuses a row whose barcode is already in the catalogue", async () => {
        const csv = "Title,EAN,Price\nYam Flour,5901234123457,2300\n"
        const mapping = { Title: "title", EAN: "barcode", Price: "selling_price" }
        await api.post("/admin/catalogue-import", { csv, source: "Repeat", mapping }, admin)

        const { data } = await api.post("/admin/catalogue-import", { csv, source: "Repeat", mapping }, admin)
        expect(data.results).toEqual([
          expect.objectContaining({ status: "skipped", errors: ["EAN: 5901234123457 is already in the catalogue."] }),
        ])
      })
    })

    describe("saved mappings", () => {
      it("reuses the mapping from the last import of the same source", async () => {
        const csv = "Item,Cost to customer,Kilos\nOfada Rice 2kg,6500,2\n"
        const mapping = { Item: "title", "Cost to customer": "selling_price", Kilos: "weight" }
        await api.post("/admin/catalogue-import", { csv, source: "Abeokuta mill", mapping }, admin)

        const { data: first } = await api.get("/admin/catalogue-import", admin)
        expect(first.sources).toContain("Abeokuta mill")
        expect(first.fields.map((f: { key: string }) => f.key)).toEqual(expect.arrayContaining(["title", "barcode"]))

        // Next month's file from the same source, whatever case the operator types it in.
        const next = "Item,Cost to customer,Kilos,Notes\nOfada Rice 1kg,3400,1,new\n"
        const { data } = await api.post("/admin/catalogue-import/preview", { csv: next, source: "abeokuta MILL" }, admin)
        expect(data.mapping_origin).toBe("saved")
        expect(data.mapping).toEqual(mapping)

        // Another source starts from suggestions.
        const { data: other } = await api.post("/admin/catalogue-import/preview", { csv: next, source: "Someone else" }, admin)
        expect(other.mapping_origin).toBe("suggested")
      })
    })
  },
})
