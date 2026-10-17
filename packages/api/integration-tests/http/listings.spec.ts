import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MercurModules } from "@mercurjs/types"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PRODUCTS, SEED_SELLERS } from "../../src/scripts/seed-data"

jest.setTimeout(5 * 60 * 1000)

const LANTERN = SEED_PRODUCTS.find((p) => p.title === "Rechargeable LED Lantern")!
const KAFTAN = SEED_PRODUCTS.find((p) => p.title === "Adire Kaftan")!

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let headers: Record<string, string>
    let regionId: string

    // Seeded once; the runner restores this snapshot before every test.
    beforeAll(async () => {
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })

    beforeEach(async () => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: keys } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
      headers = { "x-publishable-api-key": keys[0].token }
      const { data: regions } = await query.graph({ entity: "region", fields: ["id"] })
      regionId = regions[0].id
    })

    const sellerId = async (name: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity: "seller", fields: ["id"], filters: { name } })
      return data[0].id as string
    }
    const productId = async (title: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity: "product", fields: ["id"], filters: { title } })
      return data[0].id as string
    }
    const shipsIn = async (name: string, days: number) =>
      (getContainer().resolve(MercurModules.SELLER) as any).updateSellers({
        id: await sellerId(name),
        default_leadtime_to_ship: days,
      })
    /** The feed as "product @ shop", before any shop sets a ship time: the order listings were first made. */
    const asListed = async (): Promise<string[]> =>
      (await list({ limit: 100 })).data.listings.map((l: any) => `${l.product.title} @ ${l.seller.name}`)
    const list = (params: Record<string, string | number> = {}) =>
      api.get(`/store/listings?${new URLSearchParams({ region_id: regionId, ...params } as any)}`, { headers })
    const detail = (seller: string, product: string, region = regionId) =>
      api.get(`/store/listings/${seller}/${product}?region_id=${region}`, { headers })

    describe("GET /store/listings", () => {
      it("lists one listing per shop and product, each with its seller, product and offers priced in the region", async () => {
        const { data } = await list({ limit: 100 })

        expect(data.listings.length).toBeGreaterThan(0)
        expect(data.count).toBe(data.listings.length)
        const pairs = data.listings.map((l: any) => `${l.seller.id}:${l.product.id}`)
        expect(new Set(pairs).size).toBe(pairs.length)
        for (const listing of data.listings) {
          expect(listing.seller).toEqual(
            expect.objectContaining({ id: expect.any(String), name: expect.any(String), area: expect.any(String) })
          )
          expect(listing.product).toEqual(expect.objectContaining({ id: expect.any(String), title: expect.any(String) }))
          expect(listing.offers.length).toBeGreaterThan(0)
          for (const offer of listing.offers) {
            expect(offer.calculated_price.currency_code).toBe("ngn")
          }
        }
      })

      it("lists a product sold by two shops as two listings, each at its own shop's price", async () => {
        const { data } = await list({ limit: 100 })
        const lantern = data.listings.filter((l: any) => l.product.title === LANTERN.title)

        const priceBySeller = Object.fromEntries(
          lantern.map((l: any) => [l.seller.name, l.offers[0].calculated_price.calculated_amount])
        )
        expect(priceBySeller).toEqual({ "Ikeja Gadget Hub": LANTERN.price, "Iya Bisi Foodstuff": LANTERN.also_at![0].price })
      })

      it("carries every variant offer of a sized product in the shop's listing", async () => {
        const { data } = await list({ limit: 100 })
        const kaftan = data.listings.find((l: any) => l.product.title === KAFTAN.title)

        expect(kaftan.offers.map((o: any) => o.variant_title).sort()).toEqual(["L", "M", "S", "XL"])
      })

      it("narrows to one shop and leaves out a product, for same-shop suggestions", async () => {
        const seller = await sellerId("Ikeja Gadget Hub")
        const lantern = await productId(LANTERN.title)

        const { data } = await list({ seller_id: seller, exclude_product_id: lantern, limit: 100 })

        expect(data.listings.length).toBeGreaterThan(0)
        expect(data.listings.every((l: any) => l.seller.id === seller)).toBe(true)
        expect(data.listings.some((l: any) => l.product.id === lantern)).toBe(false)
      })

      it("pages through listings", async () => {
        const all = (await list({ limit: 100 })).data.listings.map((l: any) => `${l.seller.id}:${l.product.id}`)
        const first = await list({ limit: 2, offset: 0 })
        const second = await list({ limit: 2, offset: 2 })

        expect(first.data).toMatchObject({ count: all.length, limit: 2, offset: 0 })
        expect([...first.data.listings, ...second.data.listings].map((l: any) => `${l.seller.id}:${l.product.id}`)).toEqual(
          all.slice(0, 4)
        )
      })

      it("shows nothing in a region the shops don't serve", async () => {
        const ghana = await getContainer()
          .resolve(Modules.REGION)
          .createRegions({ name: "Ghana", currency_code: "ghs", countries: ["gh"] })

        const { data } = await api.get(`/store/listings?region_id=${ghana.id}`, { headers })

        expect(data).toMatchObject({ listings: [], count: 0 })
      })

      it("hides a product outside the publishable key's sales channel", async () => {
        const lantern = await productId(LANTERN.title)
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: channels } = await query.graph({ entity: "sales_channel", fields: ["id"] })
        await getContainer()
          .resolve(ContainerRegistrationKeys.LINK)
          .dismiss(
            channels.map((c: any) => ({
              [Modules.PRODUCT]: { product_id: lantern },
              [Modules.SALES_CHANNEL]: { sales_channel_id: c.id },
            }))
          )

        const { data } = await list({ limit: 100 })

        expect(data.listings.some((l: any) => l.product.id === lantern)).toBe(false)
      })

      it("hides a suspended shop's listings", async () => {
        const seller = await sellerId("Adire House")
        await (getContainer().resolve(MercurModules.SELLER) as any).updateSellers({ id: seller, status: "suspended" })

        const { data } = await list({ limit: 100 })

        expect(data.listings.some((l: any) => l.seller.id === seller)).toBe(false)
      })

      it("requires a region", async () => {
        const res = await api.get("/store/listings", { headers }).catch((e) => e.response)
        expect(res.status).toBe(400)
      })
    })

    describe("search", () => {
      it("finds listings whose product name holds every word of the query, ignoring case", async () => {
        const { data } = await list({ q: "rechargeable LANTERN", limit: 100 })

        expect(data.listings.map((l: any) => l.product.title)).toEqual([LANTERN.title, LANTERN.title])
        expect(data.count).toBe(2)
      })

      it("orders the best name matches first, then the fastest shops, never the cheapest", async () => {
        const listed = await asListed()
        // The dearer shop ships sooner, so a price order would put it last.
        await shipsIn("Iya Bisi Foodstuff", 1)
        await shipsIn("Ikeja Gadget Hub", 3)

        const { data } = await list({ q: "charge", limit: 100 })
        const found = data.listings.map((l: any) => `${l.product.title} @ ${l.seller.name}`)

        // "Charger" starts a word of its name; the rest only hold "charge" inside "Rechargeable".
        expect(found.slice(0, 3)).toEqual([
          "25W USB-C Fast Charger @ Iya Bisi Foodstuff",
          "25W USB-C Fast Charger @ Ikeja Gadget Hub",
          "Rechargeable LED Lantern @ Iya Bisi Foodstuff",
        ])
        // Equal on match and ship time: the order they were first listed.
        expect(found.slice(3)).toEqual(
          listed.filter((l) =>
            ["Rechargeable LED Lantern @ Ikeja Gadget Hub", "Rechargeable Standing Fan 16-inch @ Ikeja Gadget Hub"].includes(l)
          )
        )
      })
    })

    describe("by category", () => {
      const categoryId = async (name: string) => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({ entity: "product_category", fields: ["id"], filters: { name } })
        return data[0].id as string
      }
      const titlesIn = (category: string) =>
        SEED_PRODUCTS.filter((p) => p.category === category || p.department === category).map((p) => p.title)

      it("lists only the category's products, fastest shops first, never the cheapest", async () => {
        const listed = await asListed()
        await shipsIn("Iya Bisi Foodstuff", 1)
        await shipsIn("Ikeja Gadget Hub", 3)

        const { data } = await list({ category_id: await categoryId("Power & Lighting"), limit: 100 })
        const found = data.listings.map((l: any) => `${l.product.title} @ ${l.seller.name}`)

        // The dearer shop's lantern leads: it ships in a day. The rest, equal, keep the order they were listed.
        const atIkeja = titlesIn("Power & Lighting").map((title) => `${title} @ Ikeja Gadget Hub`)
        expect(found).toEqual([
          "Rechargeable LED Lantern @ Iya Bisi Foodstuff",
          ...listed.filter((l) => atIkeja.includes(l)),
        ])
      })

      it("includes a department's sub-categories", async () => {
        const { data } = await list({ category_id: await categoryId("Electronics"), limit: 100 })

        expect(new Set(data.listings.map((l: any) => l.product.title))).toEqual(new Set(titlesIn("Electronics")))
      })
    })

    describe("GET /store/shops/:seller_id", () => {
      const shop = (seller: string, region = regionId) =>
        api.get(`/store/shops/${seller}?region_id=${region}`, { headers })

      it("returns the shop's header: name, description, area and ship time", async () => {
        const seller = await sellerId("Iya Bisi Foodstuff")
        await shipsIn("Iya Bisi Foodstuff", 2)

        const { data } = await shop(seller)

        expect(data.shop).toMatchObject({
          id: seller,
          name: "Iya Bisi Foodstuff",
          description: SEED_SELLERS[0].description,
          area: "Surulere",
          default_leadtime_to_ship: 2,
        })
      })

      it("pairs with the listings narrowed to the shop, which hold only its own offers", async () => {
        const seller = await sellerId("Iya Bisi Foodstuff")

        const { data } = await list({ seller_id: seller, limit: 100 })

        expect(data.listings.length).toBeGreaterThan(0)
        expect(data.listings.every((l: any) => l.seller.id === seller)).toBe(true)
        // It also sells the lantern, at its own price.
        const lantern = data.listings.find((l: any) => l.product.title === LANTERN.title)
        expect(lantern.offers[0].calculated_price.calculated_amount).toBe(LANTERN.also_at![0].price)
      })

      it("orders the shop's listings by what ships soonest, then as first listed, never by price", async () => {
        const seller = await sellerId("Ikeja Gadget Hub")
        await shipsIn("Ikeja Gadget Hub", 3)
        const titles = async () =>
          (await list({ seller_id: seller, limit: 100 })).data.listings.map((l: any) => l.product.title)
        const asListed = await titles()
        // Its dearest product ships sooner than the shop's usual three days.
        const fan = "Rechargeable Standing Fan 16-inch"
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: offers } = await query.graph({
          entity: "offer",
          fields: ["id"],
          filters: { seller_id: seller, product_id: await productId(fan) },
        })
        await (getContainer().resolve(MercurModules.OFFER) as any).updateOffers({ id: offers[0].id, leadtime_to_ship: 1 })

        expect(await titles()).toEqual([fan, ...asListed.filter((t: string) => t !== fan)])
      })

      it("is not found for a suspended shop", async () => {
        const seller = await sellerId("Adire House")
        await (getContainer().resolve(MercurModules.SELLER) as any).updateSellers({ id: seller, status: "suspended" })

        const res = await shop(seller).catch((e) => e.response)

        expect(res.status).toBe(404)
      })

      it("is not found in a region the shop doesn't serve", async () => {
        const ghana = await getContainer()
          .resolve(Modules.REGION)
          .createRegions({ name: "Ghana", currency_code: "ghs", countries: ["gh"] })

        const res = await shop(await sellerId("Adire House"), ghana.id).catch((e) => e.response)

        expect(res.status).toBe(404)
      })
    })

    describe("GET /store/listings/:seller_id/:product_id", () => {
      it("returns the product in the chosen shop's context, never the cheapest shop's", async () => {
        const dearer = await sellerId("Iya Bisi Foodstuff")
        const lantern = await productId(LANTERN.title)

        const { data } = await detail(dearer, lantern)

        expect(data.listing.seller).toMatchObject({ id: dearer, name: "Iya Bisi Foodstuff" })
        expect(data.listing.offers.map((o: any) => o.calculated_price.calculated_amount)).toEqual([
          LANTERN.also_at![0].price,
        ])
        expect(data.listing.offers[0].calculated_price.original_amount).toBe(LANTERN.also_at![0].price)
      })

      it("returns the product's details: images, description, weight and attributes, and the shop's ship time", async () => {
        const shop = await sellerId("Ikeja Gadget Hub")
        const lantern = await productId(LANTERN.title)

        const { data } = await detail(shop, lantern)

        expect(data.listing.product).toMatchObject({
          title: LANTERN.title,
          description: LANTERN.description,
          weight: LANTERN.weight_grams,
        })
        expect(data.listing.product.images.length).toBeGreaterThan(0)
        expect(data.listing.product.attributes).toEqual(
          expect.arrayContaining([
            { name: "Voltage", values: [LANTERN.attributes.voltage] },
            { name: "Warranty", values: [LANTERN.attributes.warranty] },
          ])
        )
        expect(data.listing.leadtime_to_ship).toEqual(expect.any(Number))
      })

      it("is not found for a shop that doesn't sell the product", async () => {
        const fashion = await sellerId("Adire House")
        const lantern = await productId(LANTERN.title)

        const res = await detail(fashion, lantern).catch((e) => e.response)

        expect(res.status).toBe(404)
      })

      it("is not found in a region the shop doesn't serve", async () => {
        const ghana = await getContainer()
          .resolve(Modules.REGION)
          .createRegions({ name: "Ghana", currency_code: "ghs", countries: ["gh"] })
        const shop = await sellerId("Ikeja Gadget Hub")
        const lantern = await productId(LANTERN.title)

        const res = await detail(shop, lantern, ghana.id).catch((e) => e.response)

        expect(res.status).toBe(404)
      })
    })
  },
})
