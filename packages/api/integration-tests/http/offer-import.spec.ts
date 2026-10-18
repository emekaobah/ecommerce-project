import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MercurModules } from "@mercurjs/types"
import { updateMemberRoleWorkflow } from "@mercurjs/core/workflows"
import seedDemoData from "../../src/scripts/seed"
import { OFFER_IMPORT_MODULE, type OfferImportModuleService } from "../../src/modules/offer-import"
import { PRODUCT_ENRICHMENT_MODULE } from "../../src/modules/product-enrichment"
import type ProductEnrichmentModuleService from "../../src/modules/product-enrichment/service"
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

    /** The grocery shop's staff member, given a role made for the test: offers can be read and created, not updated. */
    const offerCreator = async () => {
      const container = getContainer()
      const rbac = container.resolve(Modules.RBAC) as any
      const policies = await rbac.listRbacPolicies({ key: ["offer:read", "offer:create"] })
      const [role] = await rbac.createRbacRoles([{ id: "role_test_offer_creator", name: "Offer creator" }])
      await rbac.createRbacRolePolicies(policies.map((p: { id: string }) => ({ role_id: role.id, policy_id: p.id })))
      const { data: me } = await api.get(`/vendor/sellers/${await sellerId(grocery)}/members/me`, await staff())
      await updateMemberRoleWorkflow(container).run({ input: { seller_member_id: me.seller_member.id, role_id: role.id } })
      return staff()
    }

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
          [3, "update"],
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
        // The shop already sells the rice (seeded at ₦14,500): the row updates that offer's price.
        expect(ofada).toMatchObject({ title: "Ofada Rice 5kg", errors: [], changes: ["Price NGN 14,500 → NGN 15,000"] })
        expect(zobo).toMatchObject({ title: "Zobo Drink 50cl", price: 1500, cost: 900, stock: null })
        expect(kuliKuli.warnings).toEqual(["EAN: Barcode had lost its leading zeros; read it as 0012345678905."])
        expect(blank.errors).toEqual(["Needs a title or a barcode."])
        expect(data.summary).toEqual({ total: 5, offers: 1, proposals: 2, updates: 1, unchanged: 0, invalid: 1 })

        expect(await offersOf(await owner(), `variant_id=${await variantOf("20,000mAh Power Bank")}`)).toEqual([])
      })
    })

    describe("import", () => {
      it("offers matched rows for the importing shop and proposes the rest, linked to the shop, for review", async () => {
        const headers = await owner()
        const { data } = await api.post("/vendor/offer-import", { csv: SHOP_CSV, mapping: SHOP_MAPPING }, headers)

        expect(data.results.map((r: any) => [r.row, r.status])).toEqual([
          [2, "offered"],
          [3, "updated"],
          [4, "proposed"],
          [5, "proposed"],
          [6, "skipped"],
        ])
        expect(data.summary).toEqual({ total: 5, offered: 1, proposed: 2, updated: 1, unchanged: 0, skipped: 1, failed: 0 })

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

      describe("re-importing", () => {
        const LIST = ["Item,EAN,Price,Unit cost,Qty", "Power bank,5901234123457,25000,26000,12", "Zobo Drink 50cl,,1500,900,"].join("\n")
        const powerBankOffers = async (shop = grocery) => offersOf(await owner(shop), `variant_id=${await variantOf("20,000mAh Power Bank")}`)
        const stockOf = async (offerId: string) => {
          const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
          const { data: [offer] } = await query.graph({
            entity: "offer",
            fields: ["manage_inventory", "inventory_items.location_levels.stocked_quantity"],
            filters: { id: offerId },
          })
          return {
            tracked: offer.manage_inventory,
            levels: offer.inventory_items.flatMap((i: any) => i.location_levels.map((l: any) => l.stocked_quantity)),
          }
        }
        const costOf = async (offerId: string) =>
          (await api.get(`/vendor/offer-costs?offer_id=${offerId}`, await owner())).data.offer_costs[0]

        it("updates the shop's offer with the list's new price, stock and cost, creating no second offer", async () => {
          const { data: first } = await api.post("/vendor/offer-import", { csv: LIST, mapping: SHOP_MAPPING }, await owner())
          const [offered, zobo] = first.results

          const next = ["Item,EAN,Price,Unit cost,Qty", "Power bank,5901234123457,27000,26500,30", "Zobo Drink 50cl,,1600,,8"].join("\n")
          const { data: preview } = await api.post("/vendor/offer-import/preview", { csv: next, mapping: SHOP_MAPPING }, await owner())
          expect(preview.rows.map((r: any) => [r.action, r.changes])).toEqual([
            ["update", ["Price NGN 25,000 → NGN 27,000", "Cost price NGN 26,000 → NGN 26,500", "Stock 12 → 30"]],
            // Found again by the SKU the first import made from its title; it starts counting stock.
            ["update", ["Price NGN 1,500 → NGN 1,600", "Stock not tracked → 8"]],
          ])

          const { data } = await api.post("/vendor/offer-import", { csv: next, mapping: SHOP_MAPPING }, await owner())
          expect(data.results.map((r: any) => [r.status, r.offer_id])).toEqual([
            ["updated", offered.offer_id],
            ["updated", zobo.offer_id],
          ])
          const offers = await powerBankOffers()
          expect(offers.map((o: any) => [o.id, o.prices.map((p: any) => p.amount)])).toEqual([[offered.offer_id, [27000]]])
          expect(await stockOf(offered.offer_id)).toEqual({ tracked: true, levels: [30] })
          expect(await costOf(offered.offer_id)).toMatchObject({ amount: 26500, price: 27000, below_cost: false })
          expect(await stockOf(zobo.offer_id)).toEqual({ tracked: true, levels: [8] })
          // The cost the second list left out stays as it was.
          expect(await costOf(zobo.offer_id)).toMatchObject({ amount: 900, price: 1600 })
        })

        it("changes nothing when the same list is imported again", async () => {
          const { data: first } = await api.post("/vendor/offer-import", { csv: LIST, mapping: SHOP_MAPPING }, await owner())
          const { data } = await api.post("/vendor/offer-import", { csv: LIST, mapping: SHOP_MAPPING }, await owner())

          expect(data.results.map((r: any) => [r.status, r.offer_id])).toEqual(first.results.map((r: any) => ["unchanged", r.offer_id]))
          expect(data.summary).toMatchObject({ unchanged: 2, offered: 0, proposed: 0, updated: 0 })
          expect(await powerBankOffers()).toHaveLength(1)
          const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
          const { data: zobos } = await query.graph({ entity: "product", fields: ["id"], filters: { title: "Zobo Drink 50cl" } })
          expect(zobos).toHaveLength(1)
          expect(await stockOf(first.results[0].offer_id)).toEqual({ tracked: true, levels: [12] })
          expect(await stockOf(first.results[1].offer_id)).toEqual({ tracked: false, levels: [] })
        })

        it("never touches another shop's offers", async () => {
          const { data: grocerys } = await api.post("/vendor/offer-import", { csv: LIST, mapping: SHOP_MAPPING }, await owner())
          const groceryOffer = grocerys.results[0].offer_id

          // The fashion shop's list names the same barcode, and the grocery's SKU for it.
          const csv = "Item,EAN,SKU,Price\nPower bank,5901234123457,FASHION-PB,30000\nSomething else,,5901234123457,500\n"
          const { data } = await api.post("/vendor/offer-import", { csv, mapping: { Item: "title", EAN: "barcode", SKU: "sku", Price: "selling_price" } }, await owner(fashion))
          expect(data.results.map((r: any) => r.status)).toEqual(["offered", "proposed"])

          const [mine] = await powerBankOffers()
          expect(mine).toMatchObject({ id: groceryOffer })
          expect(mine.prices.map((p: any) => p.amount)).toEqual([25000])
          expect(await powerBankOffers(fashion)).toEqual([expect.objectContaining({ seller_id: await sellerId(fashion) })])
        })
      })

      describe("each row is all or nothing", () => {
        afterEach(() => jest.restoreAllMocks())

        const productsTitled = async (title: string) => {
          const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
          const { data } = await query.graph({ entity: "product", fields: ["id"], filters: { title } })
          return data
        }
        const shopCosts = async () =>
          getContainer().resolve<OfferImportModuleService>(OFFER_IMPORT_MODULE).listOfferCosts({ seller_id: await sellerId(grocery) })

        it("leaves no proposal, enrichment or cost behind when a proposed row's offer can't be created", async () => {
          const offers = getContainer().resolve(MercurModules.OFFER) as { createOffers: (...args: unknown[]) => Promise<unknown> }
          jest.spyOn(offers, "createOffers").mockRejectedValueOnce(new Error("offer refused"))

          const csv = "Item,Price,Unit cost\nZobo Drink 50cl,1500,900\n"
          const { data } = await api.post("/vendor/offer-import", { csv, mapping: { Item: "title", Price: "selling_price", "Unit cost": "cost_price" } }, await owner())

          expect(data.results).toEqual([expect.objectContaining({ status: "failed", product_id: null, offer_id: null, errors: ["offer refused"] })])
          expect(await productsTitled("Zobo Drink 50cl")).toEqual([])
          expect(await shopCosts()).toEqual([])
          const enrichments = await getContainer().resolve<ProductEnrichmentModuleService>(PRODUCT_ENRICHMENT_MODULE).listProductEnrichments({})
          expect(enrichments).toEqual([])

          // Nothing half-made to trip over: the same row imports cleanly on a retry.
          const { data: retry } = await api.post("/vendor/offer-import", { csv, mapping: { Item: "title", Price: "selling_price", "Unit cost": "cost_price" } }, await owner())
          expect(retry.results.map((r: any) => r.status)).toEqual(["proposed"])
          expect(await productsTitled("Zobo Drink 50cl")).toHaveLength(1)
        })

        it("creates no offer when its cost can't be saved", async () => {
          const service = getContainer().resolve<OfferImportModuleService>(OFFER_IMPORT_MODULE)
          jest.spyOn(service, "createOfferCosts").mockRejectedValueOnce(new Error("cost refused"))

          const { data } = await api.post("/vendor/offer-import", { csv: SHOP_CSV, mapping: SHOP_MAPPING }, await owner())

          expect(data.results[0]).toMatchObject({ row: 2, status: "failed", offer_id: null, errors: ["cost refused"] })
          expect(await offersOf(await owner(), `variant_id=${await variantOf("20,000mAh Power Bank")}`)).toEqual([])
        })
      })

      it("refuses a mapping with a field from two columns, creating nothing", async () => {
        const error = await api
          .post("/vendor/offer-import", { csv: "Name,Item,Price\nA,B,100\n", mapping: { Name: "title", Item: "title", Price: "selling_price" } }, await owner())
          .catch((e: any) => e)
        expect(error.response?.status).toBe(400)
        expect(error.response.data.message).toContain("Title is mapped from more than one column")
      })
    })

    describe("sale price", () => {
      // Seeded: the gadget shop sells the power bank at ₦24,000, and the lantern at ₦9,800,
      // which the grocery shop also sells, at ₦10,500 (#46).
      const gadgets = SEED_SELLERS.find((s) => s.name === "Ikeja Gadget Hub")!
      const LANTERN_BARCODE = "2000000000121"
      const SALE_MAPPING = { Item: "title", EAN: "barcode", Price: "selling_price", "Sale price": "sale_price" }

      /** The product's price at each shop as buyers see it in listings: [now, was]. */
      const listedPrices = async (title: string) => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: keys } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
        const { data: [region] } = await query.graph({ entity: "region", fields: ["id"] })
        const { data } = await api.get(`/store/listings?region_id=${region.id}&limit=100`, {
          headers: { "x-publishable-api-key": keys[0].token },
        })
        return Object.fromEntries(
          data.listings
            .filter((l: any) => l.product.title === title)
            .map((l: any) => [l.seller.name, [l.offers[0].calculated_price.calculated_amount, l.offers[0].calculated_price.original_amount]])
        )
      }
      const salePrices = async () => {
        const headers = await owner()
        const { data } = await api.get("/vendor/price-lists?fields=id,type,status,prices.amount", headers)
        return data.price_lists.map((l: any) => [l.type, l.status, l.prices.map((p: any) => p.amount).sort((a: number, b: number) => a - b)])
      }

      it("puts the importing shop's offers on sale; another shop's offers of the same products are unchanged", async () => {
        const csv = ["Item,EAN,Price,Sale price", "Power bank,5901234123457,25000,22000", `Lantern,${LANTERN_BARCODE},,9000`].join("\n")

        const { data: preview } = await api.post("/vendor/offer-import/preview", { csv, mapping: SALE_MAPPING }, await owner())
        expect(preview.rows.map((r: any) => [r.action, r.sale, r.changes])).toEqual([
          ["offer", 22000, []],
          ["update", 9000, ["Sale price none → NGN 9,000"]],
        ])

        const { data } = await api.post("/vendor/offer-import", { csv, mapping: SALE_MAPPING }, await owner())
        expect(data.results.map((r: any) => r.status)).toEqual(["offered", "updated"])

        expect(await listedPrices("20,000mAh Power Bank")).toEqual({
          [grocery.name]: [22000, 25000],
          [gadgets.name]: [24000, 24000],
        })
        expect(await listedPrices("Rechargeable LED Lantern")).toEqual({
          [grocery.name]: [9000, 10500],
          [gadgets.name]: [9800, 9800],
        })
        // The sale is the shop's own price list, which it can change or end in the panel.
        expect(await salePrices()).toEqual([["sale", "active", [9000, 22000]]])
      })

      it("changes an offer's sale price on a re-import, rather than adding a second one", async () => {
        const sheet = (sale: number) => ["Item,EAN,Price,Sale price", `Lantern,${LANTERN_BARCODE},,${sale}`].join("\n")
        await api.post("/vendor/offer-import", { csv: sheet(9000), mapping: SALE_MAPPING }, await owner())

        const { data: preview } = await api.post("/vendor/offer-import/preview", { csv: sheet(8500), mapping: SALE_MAPPING }, await owner())
        expect(preview.rows.map((r: any) => r.changes)).toEqual([["Sale price NGN 9,000 → NGN 8,500"]])
        const { data } = await api.post("/vendor/offer-import", { csv: sheet(8500), mapping: SALE_MAPPING }, await owner())
        expect(data.results.map((r: any) => r.status)).toEqual(["updated"])

        expect(await listedPrices("Rechargeable LED Lantern")).toEqual({
          [grocery.name]: [8500, 10500],
          [gadgets.name]: [9800, 9800],
        })
        expect(await salePrices()).toEqual([["sale", "active", [8500]]])
      })

      it("sets the sale price in the shop's imported sale prices only, leaving its own sales alone", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: [lantern] } = await query.graph({ entity: "product", fields: ["variants.id"], filters: { title: "Rechargeable LED Lantern" } })
        const { data: [offer] } = await query.graph({
          entity: "offer",
          fields: ["id", "variant_id"],
          filters: { variant_id: lantern.variants[0].id, seller_id: await sellerId(grocery) },
        })
        const headers = await owner()
        const weekend = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
        await api.post(
          "/vendor/price-lists",
          {
            title: "Weekend sale",
            description: "The shop's own sale",
            type: "sale",
            status: "active",
            ends_at: weekend,
            prices: [{ variant_id: offer.variant_id, amount: 9500, currency_code: "ngn", rules: { offer_id: offer.id } }],
          },
          headers
        )
        const csv = ["Item,EAN,Price,Sale price", `Lantern,${LANTERN_BARCODE},,9000`].join("\n")

        const { data } = await api.post("/vendor/offer-import", { csv, mapping: SALE_MAPPING }, headers)
        expect(data.results.map((r: any) => [r.status, r.changes])).toEqual([["updated", ["Sale price none → NGN 9,000"]]])

        const { data: lists } = await api.get("/vendor/price-lists?fields=title,prices.amount", headers)
        expect(Object.fromEntries(lists.price_lists.map((l: any) => [l.title, l.prices.map((p: any) => p.amount)]))).toEqual({
          "Weekend sale": [9500],
          "Imported sale prices": [9000],
        })
        expect(await listedPrices("Rechargeable LED Lantern")).toEqual({
          [grocery.name]: [9000, 10500],
          [gadgets.name]: [9800, 9800],
        })
      })

      it("refuses a row that lowers the selling price to the imported sale price without lowering the sale price", async () => {
        await api.post("/vendor/offer-import", { csv: ["Item,EAN,Price,Sale price", `Lantern,${LANTERN_BARCODE},,9000`].join("\n"), mapping: SALE_MAPPING }, await owner())
        const csv = ["Item,EAN,Price,Sale price", `Lantern,${LANTERN_BARCODE},9000,`].join("\n")

        const { data } = await api.post("/vendor/offer-import", { csv, mapping: SALE_MAPPING }, await owner())

        expect(data.results.map((r: any) => [r.status, r.errors])).toEqual([
          ["skipped", ["Sale price NGN 9,000 must be below the selling price NGN 9,000."]],
        ])
        expect(await listedPrices("Rechargeable LED Lantern")).toMatchObject({ [grocery.name]: [9000, 10500] })
      })

      it("leaves prices as before for a row with no sale price", async () => {
        const csv = ["Item,EAN,Price,Sale price", "Power bank,5901234123457,25000,", `Lantern,${LANTERN_BARCODE},11000,`].join("\n")

        const { data } = await api.post("/vendor/offer-import", { csv, mapping: SALE_MAPPING }, await owner())
        expect(data.results.map((r: any) => [r.status, r.changes])).toEqual([
          ["offered", []],
          ["updated", ["Price NGN 10,500 → NGN 11,000"]],
        ])

        expect(await listedPrices("20,000mAh Power Bank")).toEqual({
          [grocery.name]: [25000, 25000],
          [gadgets.name]: [24000, 24000],
        })
        expect(await listedPrices("Rechargeable LED Lantern")).toEqual({
          [grocery.name]: [11000, 11000],
          [gadgets.name]: [9800, 9800],
        })
        expect(await salePrices()).toEqual([])
      })

      it("skips a row whose sale price isn't below its selling price", async () => {
        const csv = ["Item,EAN,Price,Sale price", "Power bank,5901234123457,25000,25000", `Lantern,${LANTERN_BARCODE},,12000`].join("\n")

        const { data } = await api.post("/vendor/offer-import", { csv, mapping: SALE_MAPPING }, await owner())
        expect(data.results.map((r: any) => [r.status, r.errors])).toEqual([
          ["skipped", ["Sale price NGN 25,000 must be below the selling price NGN 25,000."]],
          ["skipped", ["Sale price NGN 12,000 must be below the selling price NGN 10,500."]],
        ])
        expect(await salePrices()).toEqual([])
      })

      it("is for members who may price the shop's offers", async () => {
        const csv = ["Item,EAN,Price,Sale price", "Power bank,5901234123457,25000,22000"].join("\n")
        const creator = await offerCreator()

        const { data } = await api.post("/vendor/offer-import/preview", { csv, mapping: SALE_MAPPING }, creator)
        expect(data.rows.map((r: any) => [r.action, r.errors])).toEqual([[null, ["Only owners and managers can put offers on sale."]]])
        const { data: run } = await api.post("/vendor/offer-import", { csv, mapping: SALE_MAPPING }, creator)
        expect(run.results.map((r: any) => r.status)).toEqual(["skipped"])
        expect(await salePrices()).toEqual([])
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

      it("leaves cost out of the preview for a member who may create offers but not price them", async () => {
        const creator = await offerCreator()
        const { data } = await api.post("/vendor/offer-import/preview", { csv: SHOP_CSV, mapping: SHOP_MAPPING }, creator)
        expect(data.rows[0]).toMatchObject({ title: "20,000mAh Power Bank", price: 25000, cost: null })
        // The below-cost warning would give the cost away too. (The column samples echo only their own file.)
        expect(JSON.stringify(data.rows)).not.toContain("26,000")
        expect(JSON.stringify(data.rows)).not.toContain("26000")
        expect(await status(api.get("/vendor/offer-costs", creator))).toBe(403)
        // Nor may they change an offer the shop already has: the rice row is refused, and its price stays.
        expect(data.rows[1]).toMatchObject({ action: null, errors: ["Only owners and managers can change offers the shop already sells."] })
        const { data: run } = await api.post("/vendor/offer-import", { csv: SHOP_CSV, mapping: SHOP_MAPPING }, creator)
        expect(run.results.map((r: any) => r.status)).toEqual(["offered", "skipped", "proposed", "proposed", "skipped"])
        const [rice] = await offersOf(await owner(), `variant_id=${await variantOf("Ofada Rice 5kg")}`)
        expect(rice.prices.map((p: any) => p.amount)).toEqual([14500])
        // And the cost column was not read: no cost was saved for what they did create.
        expect(await getContainer().resolve<OfferImportModuleService>(OFFER_IMPORT_MODULE).listOfferCosts({})).toEqual([])

        // The owner, who may price offers, sees both.
        const { data: owners } = await api.post("/vendor/offer-import/preview", { csv: SHOP_CSV, mapping: SHOP_MAPPING }, await owner())
        expect(owners.rows[0]).toMatchObject({ cost: 26000, warnings: expect.arrayContaining(["Selling price NGN 25,000 is below cost price NGN 26,000."]) })
      })

      // The panel's offer page is the product's: it asks for the shop's costs by product.
      it("shows the owner the costs of its offers on a product, as the offer page asks for them", async () => {
        const offerId = await importPowerBank()
        const { data: offer } = await api.get(`/vendor/offers/${offerId}?fields=product_id`, await owner())

        const { data } = await api.get(`/vendor/offer-costs?product_id=${offer.offer.product_id}`, await owner())

        expect(data.offer_costs).toEqual([
          { offer_id: offerId, amount: 26000, currency_code: "ngn", price: 25000, below_cost: true },
        ])
      })

      it("never shows one shop another's costs", async () => {
        const offerId = await importPowerBank()
        const { data: offer } = await api.get(`/vendor/offers/${offerId}?fields=product_id`, await owner())
        for (const query of [`offer_id=${offerId}`, `product_id=${offer.offer.product_id}`]) {
          const { data } = await api.get(`/vendor/offer-costs?${query}`, await owner(fashion))
          expect(data.offer_costs).toEqual([])
        }
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
