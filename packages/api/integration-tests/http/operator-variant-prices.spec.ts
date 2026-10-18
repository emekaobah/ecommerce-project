import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PRODUCTS, SEED_SELLERS } from "../../src/scripts/seed-data"
import { adminHeaders } from "../helpers/auth"

jest.setTimeout(5 * 60 * 1000)

// Both seeded shops sell the lantern, so their offers share the variant's price set (#15).
const LANTERN = SEED_PRODUCTS.find((p) => p.title === "Rechargeable LED Lantern")!
const GROCERY = SEED_SELLERS.find((s) => s.name === "Iya Bisi Foodstuff")!
const GADGETS = SEED_SELLERS.find((s) => s.name === "Ikeja Gadget Hub")!
const GROCERY_PRICE = LANTERN.also_at!.find((a) => a.shop === GROCERY.name)!.price

type Shop = (typeof SEED_SELLERS)[number]

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let admin: { headers: Record<string, string> }
    let productId: string
    let variantId: string

    beforeAll(async () => {
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })

    beforeEach(async () => {
      admin = await adminHeaders(getContainer(), api)
      const { data: [product] } = await query().graph({ entity: "product", fields: ["id", "variants.id"], filters: { title: LANTERN.title } })
      productId = product.id
      variantId = product.variants[0].id
    })

    const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)

    /** The shop's lantern offer's own prices, as [currency, amount]. */
    const amounts = async (shop: Shop) => {
      const { data: [seller] } = await query().graph({ entity: "seller", fields: ["id"], filters: { email: shop.owner.email } })
      const { data: [offer] } = await query().graph({
        entity: "offer",
        fields: ["prices.amount", "prices.currency_code"],
        filters: { variant_id: variantId, seller_id: seller.id },
      })
      return (offer.prices as { amount: number; currency_code: string }[])
        .filter(Boolean)
        .map((p) => [p.currency_code, Number(p.amount)])
        .sort()
    }

    /** The request's status and, when refused, Medusa's error message. */
    const outcome = (request: Promise<unknown>) =>
      request.then(
        () => ({ status: 200, message: undefined as string | undefined }),
        (e: any) => ({ status: e.response?.status as number, message: e.response?.data?.message as string | undefined })
      )

    const PRICES = [{ amount: 1, currency_code: "ngn" }]

    const expectOffersUntouched = async () => {
      expect(await amounts(GROCERY)).toEqual([["ngn", GROCERY_PRICE]])
      expect(await amounts(GADGETS)).toEqual([["ngn", LANTERN.price]])
    }

    describe("POST /admin/products/:id/variants/:variant_id", () => {
      it("refuses prices, and both shops' offers keep theirs", async () => {
        const { status, message } = await outcome(
          api.post(`/admin/products/${productId}/variants/${variantId}`, { prices: PRICES }, admin)
        )

        expect(status).toBe(400)
        expect(message).toMatch(/offer/i)
        await expectOffersUntouched()
      })

      it("still updates the variant without prices", async () => {
        const { data } = await api.post(`/admin/products/${productId}/variants/${variantId}`, { title: "Lantern, black" }, admin)

        expect(data.product.variants.find((v: any) => v.id === variantId).title).toBe("Lantern, black")
        await expectOffersUntouched()
      })
    })

    describe("POST /admin/products/:id", () => {
      it("refuses variants with prices, and both shops' offers keep theirs", async () => {
        const { status, message } = await outcome(
          api.post(`/admin/products/${productId}`, { variants: [{ id: variantId, prices: PRICES }] }, admin)
        )

        expect(status).toBe(400)
        expect(message).toMatch(/offer/i)
        await expectOffersUntouched()
      })

      it("still updates the product and its variants without prices", async () => {
        const { data } = await api.post(
          `/admin/products/${productId}`,
          { subtitle: "Charges by USB", variants: [{ id: variantId, title: "Lantern, white" }] },
          admin
        )

        expect(data.product.subtitle).toBe("Charges by USB")
        expect(data.product.variants.find((v: any) => v.id === variantId).title).toBe("Lantern, white")
        await expectOffersUntouched()
      })
    })

    describe("POST /admin/products/batch", () => {
      it("refuses updated variants with prices", async () => {
        const { status } = await outcome(
          api.post("/admin/products/batch", { update: [{ id: productId, variants: [{ id: variantId, prices: PRICES }] }] }, admin)
        )

        expect(status).toBe(400)
        await expectOffersUntouched()
      })

      it("refuses created variants with prices", async () => {
        const create = [{ title: "Solar lantern", variants: [{ title: "Default", prices: PRICES }] }]
        expect((await outcome(api.post("/admin/products/batch", { create }, admin))).status).toBe(400)
      })
    })

    // Mercur's own create schemas have no prices field, so these were refused before ours too.
    describe("creating with prices", () => {
      it("refuses a new product's variants with prices", async () => {
        const product = { title: "Solar lantern", variants: [{ title: "Default", prices: PRICES }] }
        expect((await outcome(api.post("/admin/products", product, admin))).status).toBe(400)
      })

      it("refuses a new variant with prices", async () => {
        const variant = { title: "Lantern, red", prices: PRICES }
        expect((await outcome(api.post(`/admin/products/${productId}/variants`, variant, admin))).status).toBe(400)
        await expectOffersUntouched()
      })
    })

    describe("POST /admin/products/:id/variants/batch", () => {
      it("refuses updated variants with prices", async () => {
        const { status } = await outcome(
          api.post(`/admin/products/${productId}/variants/batch`, { update: [{ id: variantId, prices: PRICES }] }, admin)
        )

        expect(status).toBe(400)
        await expectOffersUntouched()
      })

      it("refuses created variants with prices", async () => {
        const create = [{ title: "Lantern, red", prices: PRICES }]
        expect((await outcome(api.post(`/admin/products/${productId}/variants/batch`, { create }, admin))).status).toBe(400)
        await expectOffersUntouched()
      })
    })

    describe("product imports", () => {
      /** A Medusa product sheet updating the lantern's variant, its NGN price cell holding `price`. */
      const sheet = (price: string) =>
        `Product Id,Product Title,Variant Id,Variant Title,Variant Price NGN\n${productId},${LANTERN.title},${variantId},Default,${price}\n`

      /** Uploads the sheet through the file module and asks POST /admin/products/imports to import it. */
      const importSheet = async (csv: string) => {
        const [file] = await getContainer()
          .resolve(Modules.FILE)
          .createFiles([{ filename: "products.csv", mimeType: "text/csv", content: csv }])
        const body = { file_key: file.id, originalname: "products.csv", extension: "csv", size: csv.length, mime_type: "text/csv" }
        return outcome(api.post("/admin/products/imports", body, admin))
      }

      it("refuses a sheet with variant prices", async () => {
        const { status, message } = await importSheet(sheet("1"))

        expect(status).toBe(400)
        expect(message).toMatch(/offer/i)
        await expectOffersUntouched()
      })

      it("takes a sheet whose price column is empty", async () => {
        const { message } = await importSheet(sheet(""))

        expect(message ?? "").not.toMatch(/offer/i)
        await expectOffersUntouched()
      })

      it("refuses Medusa's deprecated upload import, whose sheet can't be checked", async () => {
        const boundary = "oja-import"
        const form = [
          `--${boundary}`,
          'Content-Disposition: form-data; name="file"; filename="products.csv"',
          "Content-Type: text/csv",
          "",
          sheet("1"),
          `--${boundary}--`,
          "",
        ].join("\r\n")
        const headers = { ...admin.headers, "content-type": `multipart/form-data; boundary=${boundary}` }

        const { status, message } = await outcome(api.post("/admin/products/import", form, { headers }))

        expect(status).toBe(400)
        expect(message).toMatch(/\/admin\/products\/imports/)
        await expectOffersUntouched()
      })
    })
  },
})
