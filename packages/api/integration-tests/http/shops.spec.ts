import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MercurModules } from "@mercurjs/types"
import { seedDemoWorld } from "../../src/scripts/seed"
import { SEED_SELLERS } from "../../src/scripts/seed-data"
import { ADDRESS } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// Set before the runner loads medusa-config, which registers the Clerk provider only when a key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey

/** A few hundred metres from Computer Village: Ikeja Gadget Hub under 1 km, Iya Bisi about 10.6, Adire House about 21.2. */
const NEAR_IKEJA = { latitude: 6.59, longitude: 3.345 }
/** Off Lekki-Epe: all three shops 5 to 15 km away; Adire House about 7.5 km, Iya Bisi 8.3, Ikeja Gadget Hub 14.5. */
const OFF_LEKKI = { latitude: 6.5, longitude: 3.43 }

// Home lists shops near the buyer, each with its top products (#65): ranked as listings are
// (ADR 0011, 0014), a shop where its first listing would come in the feed.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let headers: Record<string, string>
    let regionId: string

    // Seeded once; the runner restores this snapshot before every test.
    beforeAll(async () => {
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
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
    const categoryId = async (name: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity: "product_category", fields: ["id"], filters: { name } })
      return data[0].id as string
    }
    const shipsIn = async (name: string, days: number) =>
      (getContainer().resolve(MercurModules.SELLER) as any).updateSellers({
        id: await sellerId(name),
        default_leadtime_to_ship: days,
      })
    /** A signed-in buyer's request config; a new email is a new buyer. */
    const buyer = (email: string) => ({
      headers: { ...headers, authorization: `Bearer ${clerk.sessionToken({ sub: `user_${email}`, email })}` },
    })
    /** Saves an address pinned at `pin` to the buyer's account, as the saved-address routes would. */
    const savedAddress = async (as: { headers: Record<string, string> }, pin: { latitude: number; longitude: number }) => {
      const { data } = await api.get("/store/customers/me", as)
      const [address] = await getContainer()
        .resolve(Modules.CUSTOMER)
        .createCustomerAddresses([{ ...ADDRESS, customer_id: data.customer.id, metadata: { ...ADDRESS.metadata, ...pin } }])
      return address.id as string
    }
    const guest = () => ({ headers })
    const shops = (as: { headers: Record<string, string> }, params: Record<string, string | number> = {}) =>
      api.get(`/store/shops?${new URLSearchParams({ region_id: regionId, ...params } as any)}`, as)
    const listings = (as: { headers: Record<string, string> }, params: Record<string, string | number> = {}) =>
      api.get(`/store/listings?${new URLSearchParams({ region_id: regionId, limit: 100, ...params } as any)}`, as)
    const names = (page: any[]) => page.map((s) => s.name)

    describe("GET /store/shops", () => {
      it("returns each shop with its header, its top three listings as the feed ranks them, and how many it has", async () => {
        const LOGO = "https://cdn.oja.test/gadgets/logo.png"
        const BANNER = "https://cdn.oja.test/gadgets/banner.jpg"
        const gadgets = await sellerId("Ikeja Gadget Hub")
        await (getContainer().resolve(MercurModules.SELLER) as any).updateSellers({ id: gadgets, logo: LOGO, banner: BANNER })

        const { data } = await shops(guest())
        const feed = (await listings(guest(), { seller_id: gadgets })).data
        const { data: page } = await api.get(`/store/shops/${gadgets}?region_id=${regionId}`, guest())

        expect(data).toMatchObject({ count: 3, offset: 0 })
        const shop = data.shops.find((s: any) => s.id === gadgets)
        expect(shop).toMatchObject({
          name: "Ikeja Gadget Hub",
          handle: page.shop.handle,
          logo: LOGO,
          banner: BANNER,
          area: page.shop.area,
          distance_km: null,
          shop_status: page.shop.shop_status,
          listing_count: feed.count,
        })
        expect(shop.listings).toHaveLength(3)
        expect(shop.listings.map((l: any) => l.product.id)).toEqual(feed.listings.slice(0, 3).map((l: any) => l.product.id))
        expect(shop.listings[0]).toEqual({
          product: feed.listings[0].product,
          offers: feed.listings[0].offers,
          deals: feed.listings[0].deals,
          leadtime_to_ship: feed.listings[0].leadtime_to_ship,
        })
      })

      it("ranks the nearest band first, ahead of a shop that ships sooner, with each shop's rounded distance", async () => {
        const ada = buyer("ada-home-near-ikeja@oja.test")
        const addressId = await savedAddress(ada, NEAR_IKEJA)
        await shipsIn("Adire House", 0)
        await shipsIn("Iya Bisi Foodstuff", 1)
        await shipsIn("Ikeja Gadget Hub", 3)

        const { data } = await shops(ada, { address_id: addressId })

        expect(data.shops.map((s: any) => [s.name, s.distance_km])).toEqual([
          ["Ikeja Gadget Hub", 0],
          ["Iya Bisi Foodstuff", 11],
          ["Adire House", 21],
        ])
        const body = JSON.stringify(data)
        for (const { pickup } of SEED_SELLERS) {
          expect(body).not.toContain(String(pickup.latitude))
          expect(body).not.toContain(String(pickup.longitude))
        }
      })

      it("within a band, ranks the shop that ships soonest, then the nearest", async () => {
        const ada = buyer("ada-home-off-lekki@oja.test")
        const addressId = await savedAddress(ada, OFF_LEKKI)
        for (const shop of ["Adire House", "Iya Bisi Foodstuff", "Ikeja Gadget Hub"]) await shipsIn(shop, 2)

        const sameShipTime = names((await shops(ada, { address_id: addressId })).data.shops)
        await shipsIn("Ikeja Gadget Hub", 1)
        const ikejaSooner = names((await shops(ada, { address_id: addressId })).data.shops)

        expect(sameShipTime).toEqual(["Adire House", "Iya Bisi Foodstuff", "Ikeja Gadget Hub"])
        expect(ikejaSooner).toEqual(["Ikeja Gadget Hub", "Adire House", "Iya Bisi Foodstuff"])
      })

      it("pages through shops in one stable order, each shop once", async () => {
        const ada = buyer("ada-home-pages@oja.test")
        const addressId = await savedAddress(ada, NEAR_IKEJA)
        await shipsIn("Adire House", 0)
        await shipsIn("Iya Bisi Foodstuff", 1)
        await shipsIn("Ikeja Gadget Hub", 3)

        const all = (await shops(ada, { address_id: addressId })).data
        const paged: any[] = []
        for (let offset = 0; offset < all.count; offset += 1) {
          const { data } = await shops(ada, { address_id: addressId, limit: 1, offset })
          expect(data).toMatchObject({ count: 3, limit: 1, offset })
          paged.push(...data.shops)
        }

        expect(names(paged)).toEqual(["Ikeja Gadget Hub", "Iya Bisi Foodstuff", "Adire House"])
        expect(paged.map((s) => s.id)).toEqual(all.shops.map((s: any) => s.id))
      })

      it("ranks a guest's shops without distance, by ship time and then as first listed", async () => {
        await shipsIn("Adire House", 0)
        await shipsIn("Iya Bisi Foodstuff", 1)
        await shipsIn("Ikeja Gadget Hub", 3)

        const { data } = await shops(guest())

        expect(names(data.shops)).toEqual(["Adire House", "Iya Bisi Foodstuff", "Ikeja Gadget Hub"])
        expect(data.shops.every((s: any) => s.distance_km === null)).toBe(true)
      })

      it("ranks a guest's shops nearest first from the phone's location, with rounded distances and no coordinates", async () => {
        await shipsIn("Adire House", 0)
        await shipsIn("Iya Bisi Foodstuff", 1)
        await shipsIn("Ikeja Gadget Hub", 3)

        // Snaps to 6.59,3.35 (ADR 0015).
        const { data } = await shops(guest(), { near: "6.5946,3.3454" })

        expect(data.shops.map((s: any) => [s.name, s.distance_km])).toEqual([
          ["Ikeja Gadget Hub", 1],
          ["Iya Bisi Foodstuff", 11],
          ["Adire House", 21],
        ])
        const body = JSON.stringify(data)
        for (const { pickup } of SEED_SELLERS) {
          expect(body).not.toContain(String(pickup.latitude))
          expect(body).not.toContain(String(pickup.longitude))
          expect(body).not.toContain(pickup.address_1)
        }
      })

      it("in a category, lists only the shops selling in it, with only those listings counted", async () => {
        const category = await categoryId("Power & Lighting")
        const inCategory = (await listings(guest(), { category_id: category })).data.listings

        const { data } = await shops(guest(), { category_id: category })

        const counts = Object.fromEntries(data.shops.map((s: any) => [s.name, s.listing_count]))
        expect(counts).toEqual({
          "Ikeja Gadget Hub": inCategory.filter((l: any) => l.seller.name === "Ikeja Gadget Hub").length,
          "Iya Bisi Foodstuff": inCategory.filter((l: any) => l.seller.name === "Iya Bisi Foodstuff").length,
        })
        expect(data.count).toBe(2)
        const titles = new Set(inCategory.map((l: any) => l.product.title))
        for (const shop of data.shops) for (const l of shop.listings) expect(titles.has(l.product.title)).toBe(true)
      })

      it("says how many of each top listing's offers are left, a sold-out one with none", async () => {
        const gadgets = await sellerId("Ikeja Gadget Hub")
        const { data: before } = await shops(guest())
        const [first] = before.shops.find((s: any) => s.id === gadgets).listings
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: offers } = await query.graph({
          entity: "offer",
          fields: ["inventory_item_link.inventory_item.location_levels.*"],
          filters: { id: first.offers[0].id },
        })
        const [level] = (offers[0] as any).inventory_item_link[0].inventory_item.location_levels
        await getContainer()
          .resolve(Modules.INVENTORY)
          .updateInventoryLevels([{ inventory_item_id: level.inventory_item_id, location_id: level.location_id, stocked_quantity: 0 }])

        const { data } = await shops(guest())

        const shop = data.shops.find((s: any) => s.id === gadgets)
        expect(shop.listings.map((l: any) => l.offers.map((o: any) => o.available_quantity))).toEqual([
          [0, ...first.offers.slice(1).map(() => 50)],
          ...shop.listings.slice(1).map((l: any) => l.offers.map(() => 50)),
        ])
      })

      it("hides a suspended shop", async () => {
        const adire = await sellerId("Adire House")
        await (getContainer().resolve(MercurModules.SELLER) as any).updateSellers({ id: adire, status: "suspended" })

        const { data } = await shops(guest())

        expect(data.count).toBe(2)
        expect(data.shops.some((s: any) => s.id === adire)).toBe(false)
      })

      it("requires a region", async () => {
        const res = await api.get("/store/shops", { headers }).catch((e) => e.response)
        expect(res.status).toBe(400)
      })
    })

    describe("search", () => {
      it("says how many shops matched in all, alongside how many listings", async () => {
        const all = (await listings(guest(), { q: "charge" })).data
        const shopsFound = new Set(all.listings.map((l: any) => l.seller.id)).size

        const { data } = await listings(guest(), { q: "charge", limit: 1 })

        expect(data).toMatchObject({ count: all.count, shop_count: shopsFound })
        expect(shopsFound).toBe(2)
        expect(data.listings).toHaveLength(1)
      })
    })
  },
})
