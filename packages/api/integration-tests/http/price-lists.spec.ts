import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_PRODUCTS, SEED_SELLERS } from "../../src/scripts/seed-data"
import { vendorHeaders } from "../helpers/auth"

jest.setTimeout(5 * 60 * 1000)

// Both seeded shops sell the lantern, so their offers share the variant's price set (#10).
const LANTERN = SEED_PRODUCTS.find((p) => p.title === "Rechargeable LED Lantern")!
// Only the gadget shop sells the earbuds.
const EARBUDS = SEED_PRODUCTS.find((p) => p.title === "Wireless Earbuds")!
const GROCERY = SEED_SELLERS.find((s) => s.name === "Iya Bisi Foodstuff")!
const GADGETS = SEED_SELLERS.find((s) => s.name === "Ikeja Gadget Hub")!
const GROCERY_PRICE = LANTERN.also_at!.find((a) => a.shop === GROCERY.name)!.price

type Shop = (typeof SEED_SELLERS)[number]
type Offer = { id: string; variant_id: string }

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let storeHeaders: { headers: Record<string, string> }
    let regionId: string

    beforeAll(async () => {
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })

    beforeEach(async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: keys } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
      storeHeaders = { headers: { "x-publishable-api-key": keys[0].token } }
      const { data: regions } = await query.graph({ entity: "region", fields: ["id"] })
      regionId = regions[0].id
    })

    const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)
    const sellerId = async (shop: Shop) => {
      const { data: [seller] } = await query().graph({ entity: "seller", fields: ["id"], filters: { email: shop.owner.email } })
      return seller.id as string
    }
    const owner = async (shop: Shop) => vendorHeaders(api, shop.owner.email, SEED_PASSWORD, await sellerId(shop))

    /** The shop's offer of the product's first variant. */
    const offerOf = async (shop: Shop, product: { title: string }): Promise<Offer> => {
      const { data: [found] } = await query().graph({ entity: "product", fields: ["variants.id"], filters: { title: product.title } })
      const { data: offers } = await query().graph({
        entity: "offer",
        fields: ["id", "variant_id"],
        filters: { variant_id: found.variants[0].id, seller_id: await sellerId(shop) },
      })
      return offers[0] as unknown as Offer
    }

    /** The product's price at each shop as buyers see it in listings: [now, was]. */
    const listedPrices = async (product: { title: string }) => {
      const { data } = await api.get(`/store/listings?region_id=${regionId}&limit=100`, storeHeaders)
      return Object.fromEntries(
        data.listings
          .filter((l: any) => l.product.title === product.title)
          .map((l: any) => [
            l.seller.name,
            [l.offers[0].calculated_price.calculated_amount, l.offers[0].calculated_price.original_amount],
          ])
      )
    }

    const sale = (prices: unknown[]) => ({ title: "Weekend sale", description: "Sale", type: "sale", status: "active", prices })
    const salePrice = (offer: Offer, amount: number, rules: Record<string, string> = { offer_id: offer.id }) => ({
      variant_id: offer.variant_id,
      amount,
      currency_code: "ngn",
      rules,
    })

    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    const deleteSales = async (shop: Shop) => {
      const headers = await owner(shop)
      const { data } = await api.get("/vendor/price-lists?limit=100", headers)
      for (const list of data.price_lists) await api.delete(`/vendor/price-lists/${list.id}`, headers)
    }
    afterEach(async () => {
      await deleteSales(GROCERY)
      await deleteSales(GADGETS)
    })

    describe("a shop's sale on a product other shops sell too", () => {
      it("lowers its own offer, with the original as the was-price, and leaves the other shop's alone", async () => {
        const offer = await offerOf(GROCERY, LANTERN)

        await api.post("/vendor/price-lists", sale([salePrice(offer, GROCERY_PRICE - 1000)]), await owner(GROCERY))

        expect(await listedPrices(LANTERN)).toEqual({
          [GROCERY.name]: [GROCERY_PRICE - 1000, GROCERY_PRICE],
          [GADGETS.name]: [LANTERN.price, LANTERN.price],
        })
      })

      it("refuses a sale price with no offer rule, which would discount every shop's offer", async () => {
        const offer = await offerOf(GROCERY, LANTERN)

        expect(
          await status(api.post("/vendor/price-lists", sale([salePrice(offer, 100, {})]), await owner(GROCERY)))
        ).toBe(400)

        const { data } = await api.get("/vendor/price-lists", await owner(GROCERY))
        expect(data.price_lists).toEqual([])
        expect(await listedPrices(LANTERN)).toEqual({
          [GROCERY.name]: [GROCERY_PRICE, GROCERY_PRICE],
          [GADGETS.name]: [LANTERN.price, LANTERN.price],
        })
      })

      it("refuses a sale price on another shop's offer", async () => {
        const theirs = await offerOf(GADGETS, LANTERN)

        expect(await status(api.post("/vendor/price-lists", sale([salePrice(theirs, 100)]), await owner(GROCERY)))).toBe(400)

        expect(await listedPrices(LANTERN)).toEqual({
          [GROCERY.name]: [GROCERY_PRICE, GROCERY_PRICE],
          [GADGETS.name]: [LANTERN.price, LANTERN.price],
        })
      })

      it("refuses a sale price on a variant the shop doesn't offer, even naming its own offer", async () => {
        const mine = await offerOf(GROCERY, LANTERN)
        const earbuds = await offerOf(GADGETS, EARBUDS)

        expect(
          await status(
            api.post(
              "/vendor/price-lists",
              sale([{ ...salePrice(mine, 100), variant_id: earbuds.variant_id }]),
              await owner(GROCERY)
            )
          )
        ).toBe(400)
      })
    })

    describe("POST /vendor/price-lists/:id/prices/batch", () => {
      it("adds and changes the shop's own sale prices only", async () => {
        const offer = await offerOf(GROCERY, LANTERN)
        const headers = await owner(GROCERY)
        const { data: { price_list } } = await api.post("/vendor/price-lists", sale([]), headers)

        const { data: added } = await api.post(
          `/vendor/price-lists/${price_list.id}/prices/batch`,
          { create: [salePrice(offer, GROCERY_PRICE - 1000)] },
          headers
        )
        await api.post(
          `/vendor/price-lists/${price_list.id}/prices/batch`,
          { update: [{ id: added.created[0].id, ...salePrice(offer, GROCERY_PRICE - 2000) }] },
          headers
        )

        expect(await listedPrices(LANTERN)).toEqual({
          [GROCERY.name]: [GROCERY_PRICE - 2000, GROCERY_PRICE],
          [GADGETS.name]: [LANTERN.price, LANTERN.price],
        })
      })

      it("refuses a created or changed price without the shop's own offer rule", async () => {
        const mine = await offerOf(GROCERY, LANTERN)
        const theirs = await offerOf(GADGETS, LANTERN)
        const headers = await owner(GROCERY)
        const { data: { price_list } } = await api.post("/vendor/price-lists", sale([salePrice(mine, GROCERY_PRICE - 1000)]), headers)
        const { data: { prices: [price] } } = await api.get(`/vendor/price-lists/${price_list.id}/prices`, headers)
        const batch = (body: unknown) => status(api.post(`/vendor/price-lists/${price_list.id}/prices/batch`, body, headers))

        expect(await batch({ create: [salePrice(mine, 100, {})] })).toBe(400)
        expect(await batch({ create: [salePrice(theirs, 100)] })).toBe(400)
        expect(await batch({ update: [{ id: price.id, ...salePrice(mine, 100, {}) }] })).toBe(400)
        expect(await batch({ update: [{ id: price.id, ...salePrice(theirs, 100) }] })).toBe(400)

        expect(await listedPrices(LANTERN)).toEqual({
          [GROCERY.name]: [GROCERY_PRICE - 1000, GROCERY_PRICE],
          [GADGETS.name]: [LANTERN.price, LANTERN.price],
        })
      })
    })

    describe("a sale on a product only one shop sells", () => {
      it("shows the sale price with the original as the was-price", async () => {
        const offer = await offerOf(GADGETS, EARBUDS)

        await api.post("/vendor/price-lists", sale([salePrice(offer, EARBUDS.price - 2500)]), await owner(GADGETS))

        expect(await listedPrices(EARBUDS)).toEqual({ [GADGETS.name]: [EARBUDS.price - 2500, EARBUDS.price] })
      })
    })
  },
})
