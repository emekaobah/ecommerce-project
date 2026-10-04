import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_SELLERS } from "../../src/scripts/seed-data"
import { adminHeaders, vendorHeaders } from "../helpers/auth"
import { enrichmentOf } from "../helpers/enrichment"

jest.setTimeout(5 * 60 * 1000)

// Barcodes the test gives two seeded catalogue products: one the grocery shop
// doesn't sell yet, and one it already does.
const POWER_BANK_EAN = "5901234123457"
const OFADA_EAN = "4006381333931"

// A shop's own stock list, as its spreadsheet exports it: a barcode mangled into
// scientific notation, another that lost its leading zeros, naira prices with
// thousands separators, and stock counts with units.
const SHOP_CSV = [
  "Item,EAN,Price,Unit cost,Qty",
  'Power bank,5.901234123457E+12,"₦25,000","₦26,000",12 pcs',
  "Ofada,4006381333931,15000,,",
  'Zobo Drink 50cl,,"N1,500",900,',
  'Kuli Kuli 200g,12345678905,"₦2,000",,40',
  ",,900,,",
].join("\n")

const SHOP_MAPPING = { Item: "title", EAN: "barcode", Price: "selling_price", "Unit cost": "cost_price", Qty: "stock" }

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const [grocery, fashion] = SEED_SELLERS

    beforeAll(async () => {
      const container = getContainer()
      await seedDemoData({ container, args: [] } as any)
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const products = container.resolve(Modules.PRODUCT)
      for (const [title, ean] of [
        ["20,000mAh Power Bank", POWER_BANK_EAN],
        ["Ofada Rice 5kg", OFADA_EAN],
      ]) {
        const { data: [product] } = await query.graph({ entity: "product", fields: ["variants.id"], filters: { title } })
        await products.updateProductVariants(product.variants[0].id, { ean, barcode: ean })
      }
    })

    const sellerId = async (shop: (typeof SEED_SELLERS)[number]) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { email: shop.owner.email } })
      return seller.id as string
    }
    const owner = async (shop = grocery) => vendorHeaders(api, shop.owner.email, SEED_PASSWORD, await sellerId(shop))
    const staff = async (shop = grocery) => vendorHeaders(api, shop.staff.email, SEED_PASSWORD, await sellerId(shop))

    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    const offersOf = async (headers: unknown, filters: string) => (await api.get(`/vendor/offers?${filters}`, headers)).data.offers

    const variantOf = async (title: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [product] } = await query.graph({ entity: "product", fields: ["variants.id"], filters: { title } })
      return product.variants[0].id as string
    }

    describe("preview", () => {
      it("suggests a mapping and says what each row would do, creating nothing", async () => {
        const { data } = await api.post("/vendor/offer-import/preview", { csv: SHOP_CSV }, await owner())

        expect(data.mapping_origin).toBe("suggested")
        expect(data.mapping).toEqual(SHOP_MAPPING)
        expect(data.rows.map((r: any) => [r.row, r.action])).toEqual([
          [2, "offer"],
          [3, null],
          [4, "propose"],
          [5, "propose"],
          [6, null],
        ])
        const [powerBank, ofada, zobo, kuliKuli, blank] = data.rows
        // Read through the spreadsheet's damage, and named after the catalogue product it matched.
        expect(powerBank).toMatchObject({ title: "20,000mAh Power Bank", price: 25000, cost: 26000, stock: 12 })
        expect(powerBank.warnings).toEqual([
          "EAN: Barcode was in scientific notation; read it as 5901234123457.",
          "Selling price NGN 25,000 is below cost price NGN 26,000.",
        ])
        expect(ofada.errors).toEqual([expect.stringMatching(/^You already sell Ofada Rice 5kg, as /)])
        expect(zobo).toMatchObject({ title: "Zobo Drink 50cl", price: 1500, cost: 900, stock: null })
        expect(kuliKuli.warnings).toEqual(["EAN: Barcode had lost its leading zeros; read it as 0012345678905."])
        expect(blank.errors).toEqual(["Needs a title or a barcode."])
        expect(data.summary).toEqual({ total: 5, offers: 1, proposals: 2, invalid: 2 })

        expect(await offersOf(await owner(), `variant_id=${await variantOf("20,000mAh Power Bank")}`)).toEqual([])
      })
    })

    describe("import", () => {
      it("offers matched rows for the importing shop and proposes the rest, linked to the shop, for review", async () => {
        const headers = await owner()
        const { data } = await api.post("/vendor/offer-import", { csv: SHOP_CSV, mapping: SHOP_MAPPING }, headers)

        expect(data.results.map((r: any) => [r.row, r.status])).toEqual([
          [2, "offered"],
          [3, "skipped"],
          [4, "proposed"],
          [5, "proposed"],
          [6, "skipped"],
        ])
        expect(data.summary).toEqual({ total: 5, offered: 1, proposed: 2, skipped: 2, failed: 0 })

        // The matched row is the grocery shop's offer, priced and stocked as its sheet said.
        const [offer] = await offersOf(headers, `variant_id=${await variantOf("20,000mAh Power Bank")}`)
        expect(offer).toMatchObject({ id: data.results[0].offer_id, seller_id: await sellerId(grocery), manage_inventory: true })
        expect(offer.prices.map((p: any) => [p.amount, p.currency_code])).toEqual([[25000, "ngn"]])
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [stocked] } = await query.graph({
          entity: "offer",
          fields: ["inventory_items.location_levels.stocked_quantity"],
          filters: { id: offer.id },
        })
        expect(stocked.inventory_items.flatMap((i: any) => i.location_levels.map((l: any) => l.stocked_quantity))).toEqual([12])

        // Unmatched rows are the shop's proposals: shown in its product list, queued for enrichment as a vendor's.
        const proposals = data.results.filter((r: any) => r.status === "proposed")
        const { data: listed } = await api.get(`/vendor/products?id[]=${proposals.map((p: any) => p.product_id).join("&id[]=")}&fields=id,title,status,variants.ean`, headers)
        expect(listed.products.map((p: any) => [p.title, p.status, p.variants[0].ean]).sort()).toEqual([
          ["Kuli Kuli 200g", "proposed", "0012345678905"],
          ["Zobo Drink 50cl", "proposed", null],
        ])
        const admin = await adminHeaders(getContainer(), api)
        for (const proposal of proposals) {
          const enrichment = await enrichmentOf(api, admin, proposal.product_id)
          expect(enrichment).toMatchObject({ submitter: "vendor", outcome: "needs_review" })
        }
        // Each proposal is offered at the shop's price, ready for when the operator approves it.
        const [zoboOffer] = await offersOf(headers, `id=${proposals[0].offer_id}`)
        expect(zoboOffer.prices.map((p: any) => p.amount)).toEqual([1500])
        // No stock column value: stock isn't tracked, so the offer is always available.
        expect(zoboOffer.manage_inventory).toBe(false)

        // Another shop sees none of it.
        expect(await offersOf(await owner(fashion), `id=${data.results[0].offer_id}`)).toEqual([])
      })

      it("refuses a mapping with a field from two columns, creating nothing", async () => {
        const error = await api
          .post("/vendor/offer-import", { csv: "Name,Item,Price\nA,B,100\n", mapping: { Name: "title", Item: "title", Price: "selling_price" } }, await owner())
          .catch((e: any) => e)
        expect(error.response?.status).toBe(400)
        expect(error.response.data.message).toContain("Title is mapped from more than one column")
      })
    })

    describe("cost price", () => {
      const importPowerBank = async () => {
        const { data } = await api.post("/vendor/offer-import", { csv: SHOP_CSV, mapping: SHOP_MAPPING }, await owner())
        return data.results[0].offer_id as string
      }

      it("shows the owner each offer's cost and whether it sells below it", async () => {
        const offerId = await importPowerBank()
        const { data } = await api.get(`/vendor/offer-costs?offer_id=${offerId}`, await owner())
        expect(data.offer_costs).toEqual([
          { offer_id: offerId, amount: 26000, currency_code: "ngn", price: 25000, below_cost: true },
        ])
      })

      it("is hidden from fulfilment staff, who can still see the offer itself", async () => {
        const offerId = await importPowerBank()
        const crew = await staff()

        expect(await status(api.get(`/vendor/offer-costs?offer_id=${offerId}`, crew))).toBe(403)
        const { data } = await api.get(`/vendor/offers/${offerId}?fields=*,+metadata`, crew)
        expect(data.offer.id).toBe(offerId)
        expect(JSON.stringify(data)).not.toContain("26000")
        // Staff can't import either: it creates offers.
        expect(await status(api.post("/vendor/offer-import/preview", { csv: SHOP_CSV }, crew))).toBe(403)
        expect(await status(api.post("/vendor/offer-import", { csv: SHOP_CSV, mapping: SHOP_MAPPING }, crew))).toBe(403)
      })

      it("never shows one shop another's costs", async () => {
        const offerId = await importPowerBank()
        const { data } = await api.get(`/vendor/offer-costs?offer_id=${offerId}`, await owner(fashion))
        expect(data.offer_costs).toEqual([])
      })
    })

    describe("saved mapping", () => {
      it("brings back the shop's last mapping on its next import, and only for that shop", async () => {
        const csv = "Product,Barcode no,Our price,Bought at\nTiger Nut Milk,,1200,800\n"
        const mapping = { Product: "title", "Barcode no": "barcode", "Our price": "selling_price", "Bought at": "cost_price" }
        await api.post("/vendor/offer-import", { csv, mapping }, await owner())

        const { data: setup } = await api.get("/vendor/offer-import", await owner())
        expect(setup.mapping).toEqual(mapping)
        expect(setup.fields.map((f: { key: string }) => f.key)).toEqual(expect.arrayContaining(["barcode", "cost_price", "stock"]))

        // Next week's list, with a column added.
        const next = "Product,Barcode no,Our price,Bought at,Notes\nTiger Nut Milk 1L,,2200,1500,new\n"
        const { data } = await api.post("/vendor/offer-import/preview", { csv: next }, await owner())
        expect(data.mapping_origin).toBe("saved")
        expect(data.mapping).toEqual(mapping)

        const { data: other } = await api.post("/vendor/offer-import/preview", { csv: next }, await owner(fashion))
        expect(other.mapping_origin).toBe("suggested")
      })
    })
  },
})
