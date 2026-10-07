import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_PRODUCTS, SEED_SELLERS } from "../../src/scripts/seed-data"
import { vendorHeaders } from "../helpers/auth"

jest.setTimeout(5 * 60 * 1000)

// Both seeded shops sell the lantern, so their offers share the variant's price set (#84).
const LANTERN = SEED_PRODUCTS.find((p) => p.title === "Rechargeable LED Lantern")!
const GROCERY = SEED_SELLERS.find((s) => s.name === "Iya Bisi Foodstuff")!
const GADGETS = SEED_SELLERS.find((s) => s.name === "Ikeja Gadget Hub")!
const GROCERY_PRICE = LANTERN.also_at!.find((a) => a.shop === GROCERY.name)!.price

type Shop = (typeof SEED_SELLERS)[number]

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

    /** The shop's lantern offer with its own prices. */
    const lanternOffer = async (shop: Shop) => {
      const { data: [product] } = await query().graph({ entity: "product", fields: ["variants.id"], filters: { title: LANTERN.title } })
      const { data: offers } = await query().graph({
        entity: "offer",
        fields: ["id", "sku", "prices.id", "prices.amount", "prices.currency_code"],
        filters: { variant_id: product.variants[0].id, seller_id: await sellerId(shop) },
      })
      return offers[0] as { id: string; sku: string; prices: { id: string; amount: number; currency_code: string }[] }
    }
    const amounts = async (shop: Shop) =>
      (await lanternOffer(shop)).prices.filter(Boolean).map((p) => [p.currency_code, Number(p.amount)]).sort()

    /** The lantern's price at each shop, as buyers see it in listings. */
    const listedPrices = async () => {
      const { data } = await api.get(`/store/listings?region_id=${regionId}&limit=100`, storeHeaders)
      return Object.fromEntries(
        data.listings
          .filter((l: any) => l.product.title === LANTERN.title)
          .map((l: any) => [l.seller.name, l.offers[0].calculated_price.calculated_amount])
      )
    }

    /** Each shop's lantern added to a new cart, as the line's unit price per shop. */
    const cartPrices = async () => {
      const { data: { cart } } = await api.post("/store/carts", { region_id: regionId }, storeHeaders)
      for (const shop of [GROCERY, GADGETS]) {
        await api.post(`/store/carts/${cart.id}/line-items`, { offer_id: (await lanternOffer(shop)).id, quantity: 1 }, storeHeaders)
      }
      const { data } = await api.get(`/store/carts/${cart.id}`, storeHeaders)
      const shopOf = new Map([[(await lanternOffer(GROCERY)).id, GROCERY.name], [(await lanternOffer(GADGETS)).id, GADGETS.name]])
      return Object.fromEntries(data.cart.items.map((i: any) => [shopOf.get(i.metadata?.offer_id ?? i.offer_id), Number(i.unit_price)]))
    }

    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    describe("POST /vendor/offers/:id", () => {
      it("changes only the editing shop's price; the other shop's offer keeps its own", async () => {
        const offer = await lanternOffer(GROCERY)

        await api.post(
          `/vendor/offers/${offer.id}`,
          { prices: [{ id: offer.prices[0].id, amount: GROCERY_PRICE + 500, currency_code: "ngn" }] },
          await owner(GROCERY)
        )

        expect(await amounts(GROCERY)).toEqual([["ngn", GROCERY_PRICE + 500]])
        expect(await amounts(GADGETS)).toEqual([["ngn", LANTERN.price]])
        expect(await listedPrices()).toEqual({ [GROCERY.name]: GROCERY_PRICE + 500, [GADGETS.name]: LANTERN.price })
        expect(await cartPrices()).toEqual({ [GROCERY.name]: GROCERY_PRICE + 500, [GADGETS.name]: LANTERN.price })
      })

      it("adds and drops the offer's own prices without touching the other shop's", async () => {
        const offer = await lanternOffer(GROCERY)
        const headers = await owner(GROCERY)

        await api.post(
          `/vendor/offers/${offer.id}`,
          { prices: [{ id: offer.prices[0].id, amount: GROCERY_PRICE, currency_code: "ngn" }, { amount: 7, currency_code: "usd" }] },
          headers
        )
        expect(await amounts(GROCERY)).toEqual([["ngn", GROCERY_PRICE], ["usd", 7]])

        const ngn = (await lanternOffer(GROCERY)).prices.find((p) => p.currency_code === "ngn")!
        await api.post(`/vendor/offers/${offer.id}`, { prices: [{ id: ngn.id, amount: GROCERY_PRICE, currency_code: "ngn" }] }, headers)

        expect(await amounts(GROCERY)).toEqual([["ngn", GROCERY_PRICE]])
        expect(await amounts(GADGETS)).toEqual([["ngn", LANTERN.price]])
      })

      it("refuses another offer's price id and changes nothing", async () => {
        const mine = await lanternOffer(GROCERY)
        const theirs = await lanternOffer(GADGETS)

        expect(
          await status(
            api.post(`/vendor/offers/${mine.id}`, { prices: [{ id: theirs.prices[0].id, amount: 1, currency_code: "ngn" }] }, await owner(GROCERY))
          )
        ).toBe(400)

        expect(await amounts(GROCERY)).toEqual([["ngn", GROCERY_PRICE]])
        expect(await amounts(GADGETS)).toEqual([["ngn", LANTERN.price]])
      })

      it("still updates the offer's other fields, leaving its prices alone", async () => {
        const offer = await lanternOffer(GROCERY)

        const { data } = await api.post(
          `/vendor/offers/${offer.id}`,
          { sku: "GROCERY-LANTERN", manage_inventory: false },
          await owner(GROCERY)
        )

        expect(data.offer).toMatchObject({ id: offer.id, sku: "GROCERY-LANTERN", manage_inventory: false })
        // Mercur's GET on the same path still answers.
        const { data: read } = await api.get(`/vendor/offers/${offer.id}`, await owner(GROCERY))
        expect(read.offer).toMatchObject({ id: offer.id, sku: "GROCERY-LANTERN" })
        expect(await amounts(GROCERY)).toEqual([["ngn", GROCERY_PRICE]])
        expect(await amounts(GADGETS)).toEqual([["ngn", LANTERN.price]])
      })

      describe("when the rest of the update fails", () => {
        afterEach(() => jest.restoreAllMocks())

        it("puts the offer's changed and dropped prices back, and its fields", async () => {
          const offer = await lanternOffer(GROCERY)
          const headers = await owner(GROCERY)
          await api.post(
            `/vendor/offers/${offer.id}`,
            { prices: [{ id: offer.prices[0].id, amount: GROCERY_PRICE, currency_code: "ngn" }, { amount: 7, currency_code: "usd" }] },
            headers
          )
          // The last step, linking the added price, fails after every price has been written.
          const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as { create: (...args: unknown[]) => Promise<unknown> }
          jest.spyOn(link, "create").mockRejectedValueOnce(new Error("link refused"))

          const ngn = (await lanternOffer(GROCERY)).prices.find((p) => p.currency_code === "ngn")!
          expect(
            await status(
              api.post(
                `/vendor/offers/${offer.id}`,
                { sku: "GROCERY-LANTERN", prices: [{ id: ngn.id, amount: 1, currency_code: "ngn" }, { amount: 5, currency_code: "eur" }] },
                headers
              )
            )
          ).toBe(500)

          expect(await amounts(GROCERY)).toEqual([["ngn", GROCERY_PRICE], ["usd", 7]])
          expect((await lanternOffer(GROCERY)).sku).toBe(offer.sku)
          expect(await amounts(GADGETS)).toEqual([["ngn", LANTERN.price]])
          expect(await listedPrices()).toEqual({ [GROCERY.name]: GROCERY_PRICE, [GADGETS.name]: LANTERN.price })
        })
      })

      it("refuses another shop's offer", async () => {
        const theirs = await lanternOffer(GADGETS)

        expect(
          await status(
            api.post(`/vendor/offers/${theirs.id}`, { prices: [{ id: theirs.prices[0].id, amount: 1, currency_code: "ngn" }] }, await owner(GROCERY))
          )
        ).toBe(404)
        expect(await amounts(GADGETS)).toEqual([["ngn", LANTERN.price]])
      })
    })

    describe("offer import re-price", () => {
      it("changes only the importing shop's price", async () => {
        const csv = `Item,EAN,Price\nLantern,${LANTERN.barcode},${GROCERY_PRICE + 1000}\n`
        const { data } = await api.post(
          "/vendor/offer-import",
          { csv, mapping: { Item: "title", EAN: "barcode", Price: "selling_price" } },
          await owner(GROCERY)
        )
        expect(data.results.map((r: any) => r.status)).toEqual(["updated"])

        expect(await amounts(GROCERY)).toEqual([["ngn", GROCERY_PRICE + 1000]])
        expect(await amounts(GADGETS)).toEqual([["ngn", LANTERN.price]])
        expect(await listedPrices()).toEqual({ [GROCERY.name]: GROCERY_PRICE + 1000, [GADGETS.name]: LANTERN.price })
        expect(await cartPrices()).toEqual({ [GROCERY.name]: GROCERY_PRICE + 1000, [GADGETS.name]: LANTERN.price })
      })
    })
  },
})
