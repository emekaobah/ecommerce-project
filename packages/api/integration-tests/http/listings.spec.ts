import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateSellerAddressWorkflow } from "@mercurjs/core/workflows"
import { MercurModules } from "@mercurjs/types"
import { seedDemoWorld } from "../../src/scripts/seed"
import { SEED_PRODUCTS, SEED_SELLERS } from "../../src/scripts/seed-data"
import { ADDRESS } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// Set before the runner loads medusa-config, which registers the Clerk provider only when a key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey

const LANTERN = SEED_PRODUCTS.find((p) => p.title === "Rechargeable LED Lantern")!
const KAFTAN = SEED_PRODUCTS.find((p) => p.title === "Adire Kaftan")!
const RICE = SEED_PRODUCTS.find((p) => p.title === "Ofada Rice 5kg")!

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

    // Listings measure from the buyer's saved address they deliver to (#43, ADR 0011): name
    // match, then distance band (under 5 km, 5 to 15, further), then ship time, then distance.
    describe("nearest first, from the buyer's delivery address", () => {
      /** A few hundred metres from Computer Village: Ikeja Gadget Hub under 1 km, Iya Bisi about 10.6, Adire House about 21.2. */
      const NEAR_IKEJA = { latitude: 6.59, longitude: 3.345 }
      /** Off Lekki-Epe: all three shops 5 to 15 km away; Adire House about 7.5 km, Iya Bisi 8.3, Ikeja Gadget Hub 14.5. */
      const OFF_LEKKI = { latitude: 6.5, longitude: 3.43 }

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
      const listAs = (as: { headers: Record<string, string> }, params: Record<string, string | number> = {}) =>
        api.get(`/store/listings?${new URLSearchParams({ region_id: regionId, limit: 100, ...params } as any)}`, as)
      /** Shops in the order their first listing comes. */
      const shopOrder = (listings: any[]) => [...new Set(listings.map((l) => l.seller.name))]

      it("ranks the nearest band first, ahead of a shop that ships sooner", async () => {
        const ada = buyer("ada-near-ikeja@oja.test")
        const addressId = await savedAddress(ada, NEAR_IKEJA)
        await shipsIn("Adire House", 0)
        await shipsIn("Iya Bisi Foodstuff", 1)
        await shipsIn("Ikeja Gadget Hub", 3)

        const { data } = await listAs(ada, { address_id: addressId })

        expect(shopOrder(data.listings)).toEqual(["Ikeja Gadget Hub", "Iya Bisi Foodstuff", "Adire House"])
      })

      it("within a band, ranks the shop that ships soonest, then the nearest", async () => {
        const ada = buyer("ada-off-lekki@oja.test")
        const addressId = await savedAddress(ada, OFF_LEKKI)
        for (const shop of ["Adire House", "Iya Bisi Foodstuff", "Ikeja Gadget Hub"]) await shipsIn(shop, 2)

        const sameShipTime = shopOrder((await listAs(ada, { address_id: addressId })).data.listings)
        await shipsIn("Ikeja Gadget Hub", 1)
        const ikejaSooner = shopOrder((await listAs(ada, { address_id: addressId })).data.listings)

        expect(sameShipTime).toEqual(["Adire House", "Iya Bisi Foodstuff", "Ikeja Gadget Hub"])
        expect(ikejaSooner).toEqual(["Ikeja Gadget Hub", "Adire House", "Iya Bisi Foodstuff"])
      })

      it("still ranks the best name match first, then by distance, never the cheapest", async () => {
        const listed = await asListed()
        const ada = buyer("ada-searches@oja.test")
        const addressId = await savedAddress(ada, NEAR_IKEJA)
        // The dearer shop ships sooner, but is further away.
        await shipsIn("Iya Bisi Foodstuff", 1)
        await shipsIn("Ikeja Gadget Hub", 3)

        const { data } = await listAs(ada, { q: "charge", address_id: addressId })
        const found = data.listings.map((l: any) => `${l.product.title} @ ${l.seller.name}`)

        // "Charger" starts a word of its name; the rest only hold "charge" inside "Rechargeable".
        expect(found).toEqual([
          "25W USB-C Fast Charger @ Ikeja Gadget Hub",
          "25W USB-C Fast Charger @ Iya Bisi Foodstuff",
          // Equal on match and distance: the order they were first listed.
          ...listed.filter((l) =>
            ["Rechargeable LED Lantern @ Ikeja Gadget Hub", "Rechargeable Standing Fan 16-inch @ Ikeja Gadget Hub"].includes(l)
          ),
          "Rechargeable LED Lantern @ Iya Bisi Foodstuff",
        ])
      })

      it("tells each listing's shop its rounded distance, and never a shop's coordinates", async () => {
        const ada = buyer("ada-distances@oja.test")
        const addressId = await savedAddress(ada, NEAR_IKEJA)

        const { data } = await listAs(ada, { address_id: addressId })

        const distances = Object.fromEntries(data.listings.map((l: any) => [l.seller.name, l.seller.distance_km]))
        expect(distances).toEqual({ "Ikeja Gadget Hub": 0, "Iya Bisi Foodstuff": 11, "Adire House": 21 })
        const body = JSON.stringify(data)
        for (const { pickup } of SEED_SELLERS) {
          expect(body).not.toContain(String(pickup.latitude))
          expect(body).not.toContain(String(pickup.longitude))
        }
      })

      it("tells the shop page and the product page the shop's distance too", async () => {
        const ada = buyer("ada-shop-page@oja.test")
        const addressId = await savedAddress(ada, NEAR_IKEJA)
        const seller = await sellerId("Iya Bisi Foodstuff")
        const lantern = await productId(LANTERN.title)

        const { data: shop } = await api.get(`/store/shops/${seller}?region_id=${regionId}&address_id=${addressId}`, ada)
        const { data: product } = await api.get(
          `/store/listings/${seller}/${lantern}?region_id=${regionId}&address_id=${addressId}`,
          ada
        )

        expect(shop.shop.distance_km).toBe(11)
        expect(product.listing.seller.distance_km).toBe(11)
        expect(JSON.stringify([shop, product])).not.toContain(String(SEED_SELLERS[0].pickup.latitude))
      })

      it("pages through every band in one stable order, each listing once", async () => {
        const ada = buyer("ada-pages@oja.test")
        const addressId = await savedAddress(ada, NEAR_IKEJA)
        await shipsIn("Adire House", 0)
        await shipsIn("Iya Bisi Foodstuff", 1)
        await shipsIn("Ikeja Gadget Hub", 3)
        const key = (l: any) => `${l.seller.id}:${l.product.id}`

        const all = (await listAs(ada, { address_id: addressId })).data
        const paged: any[] = []
        for (let offset = 0; offset < all.count; offset += 3) {
          const { data } = await listAs(ada, { address_id: addressId, limit: 3, offset })
          expect(data.count).toBe(all.count)
          paged.push(...data.listings)
        }

        expect(shopOrder(all.listings)).toEqual(["Ikeja Gadget Hub", "Iya Bisi Foodstuff", "Adire House"])
        expect(paged.map(key)).toEqual(all.listings.map(key))
        expect(new Set(paged.map(key)).size).toBe(all.count)
      })

      it("measures from where the shop moved its pickup pin", async () => {
        const ada = buyer("ada-shop-moved@oja.test")
        const addressId = await savedAddress(ada, NEAR_IKEJA)
        const adire = await sellerId("Adire House")
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: rows } = await query.graph({ entity: "seller", fields: ["address.metadata"], filters: { id: adire } })
        // Next door to the buyer, as the vendor panel's pickup address routes save it.
        await updateSellerAddressWorkflow(getContainer()).run({
          input: { seller_id: adire, data: { metadata: { ...rows[0].address.metadata, latitude: 6.591, longitude: 3.345 } } },
        })

        const { data } = await listAs(ada, { address_id: addressId })

        expect(data.listings.find((l: any) => l.seller.id === adire).seller.distance_km).toBe(0)
        expect(shopOrder(data.listings)[0]).toBe("Adire House")
      })

      it("keeps today's order, with no distance, without an address", async () => {
        const ada = buyer("ada-no-address@oja.test")
        await shipsIn("Adire House", 0)
        await shipsIn("Iya Bisi Foodstuff", 1)
        await shipsIn("Ikeja Gadget Hub", 3)

        const { data } = await listAs(ada)

        expect(shopOrder(data.listings)).toEqual(["Adire House", "Iya Bisi Foodstuff", "Ikeja Gadget Hub"])
        expect(data.listings.every((l: any) => l.seller.distance_km === null)).toBe(true)
      })

      it("ignores another buyer's address, and a guest's", async () => {
        const addressId = await savedAddress(buyer("ada-owner@oja.test"), NEAR_IKEJA)
        await shipsIn("Adire House", 0)
        await shipsIn("Iya Bisi Foodstuff", 1)
        await shipsIn("Ikeja Gadget Hub", 3)

        const asBola = (await listAs(buyer("bola-someone-else@oja.test"), { address_id: addressId })).data
        const asGuest = (await listAs({ headers }, { address_id: addressId })).data
        const shop = (
          await api.get(`/store/shops/${await sellerId("Ikeja Gadget Hub")}?region_id=${regionId}&address_id=${addressId}`, {
            headers,
          })
        ).data.shop

        for (const data of [asBola, asGuest]) {
          expect(shopOrder(data.listings)).toEqual(["Adire House", "Iya Bisi Foodstuff", "Ikeja Gadget Hub"])
          expect(data.listings.every((l: any) => l.seller.distance_km === null)).toBe(true)
        }
        expect(shop.distance_km).toBeNull()
      })

      // Without a usable saved address, the phone's location (`near`), snapped to a 2-decimal grid (ADR 0015).
      describe("from the phone's location", () => {
        it("ranks a guest's listings nearest first, with each shop's rounded distance", async () => {
          await shipsIn("Adire House", 0)
          await shipsIn("Iya Bisi Foodstuff", 1)
          await shipsIn("Ikeja Gadget Hub", 3)

          const { data } = await listAs({ headers }, { near: "6.59,3.35" })

          expect(shopOrder(data.listings)).toEqual(["Ikeja Gadget Hub", "Iya Bisi Foodstuff", "Adire House"])
          const distances = Object.fromEntries(data.listings.map((l: any) => [l.seller.name, l.seller.distance_km]))
          expect(distances).toEqual({ "Ikeja Gadget Hub": 1, "Iya Bisi Foodstuff": 11, "Adire House": 21 })
        })

        it("measures from the centre of the location's 2-decimal grid cell, so two points in one cell get the same answer", async () => {
          // Both snap to 6.59,3.35. Measured as sent, they'd read Ikeja Gadget Hub 0 km and Adire House 22 km,
          // and Ikeja Gadget Hub 2 km and Adire House 20 km.
          const north = await listAs({ headers }, { near: "6.5946,3.3454" })
          const south = await listAs({ headers }, { near: "6.5854,3.3546" })

          expect(north.data).toEqual(south.data)
          const distances = Object.fromEntries(north.data.listings.map((l: any) => [l.seller.name, l.seller.distance_km]))
          expect(distances).toEqual({ "Ikeja Gadget Hub": 1, "Iya Bisi Foodstuff": 11, "Adire House": 21 })
        })
      })
    })

    describe("shop logos and banners", () => {
      const LOGO = "https://cdn.oja.test/gadgets/logo.png"
      const BANNER = "https://cdn.oja.test/gadgets/banner.jpg"
      /** Ikeja Gadget Hub uploads a logo and banner; Iya Bisi Foodstuff has neither. */
      const withImages = async () => {
        const sellers = getContainer().resolve(MercurModules.SELLER) as any
        const gadgets = await sellerId("Ikeja Gadget Hub")
        const grocery = await sellerId("Iya Bisi Foodstuff")
        await sellers.updateSellers({ id: gadgets, logo: LOGO, banner: BANNER })
        await sellers.updateSellers({ id: grocery, logo: null, banner: null })
        return { gadgets, grocery }
      }

      it("shows each listing's shop with its logo and banner, or nulls when it has none", async () => {
        const { gadgets, grocery } = await withImages()

        const { data } = await list({ limit: 100 })

        const images = (id: string) =>
          data.listings.filter((l: any) => l.seller.id === id).map((l: any) => [l.seller.logo, l.seller.banner])
        expect(new Set(images(gadgets).map(String))).toEqual(new Set([String([LOGO, BANNER])]))
        expect(new Set(images(grocery).map(String))).toEqual(new Set([String([null, null])]))
      })

      it("shows the shop page's logo and banner, or nulls when it has none", async () => {
        const { gadgets, grocery } = await withImages()

        const shopOf = async (id: string) =>
          (await api.get(`/store/shops/${id}?region_id=${regionId}`, { headers })).data.shop

        expect(await shopOf(gadgets)).toMatchObject({ logo: LOGO, banner: BANNER })
        expect(await shopOf(grocery)).toMatchObject({ logo: null, banner: null })
      })

      it("shows the product page's shop logo and banner", async () => {
        const { gadgets } = await withImages()

        const { data } = await detail(gadgets, await productId(LANTERN.title))

        expect(data.listing.seller).toMatchObject({ logo: LOGO, banner: BANNER })
      })
    })

    describe("stock", () => {
      /** The shop's offer of the rice, its only variant. */
      const riceOffer = async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "offer",
          fields: ["id", "inventory_item_link.inventory_item.location_levels.*"],
          filters: { seller_id: await sellerId("Iya Bisi Foodstuff"), product_id: await productId(RICE.title) },
        })
        return data[0] as any
      }
      /** Stocks the rice at its location with `stocked`, `reserved` of them held for orders not yet shipped. */
      const stockRice = async (stocked: number, reserved = 0) => {
        const [level] = (await riceOffer()).inventory_item_link[0].inventory_item.location_levels
        const inventory = getContainer().resolve(Modules.INVENTORY)
        const at = { inventory_item_id: level.inventory_item_id, location_id: level.location_id }
        await inventory.updateInventoryLevels([{ ...at, stocked_quantity: stocked }])
        if (reserved) await inventory.createReservationItems([{ ...at, quantity: reserved }])
      }
      const updateRice = async (update: Record<string, unknown>) =>
        (getContainer().resolve(MercurModules.OFFER) as any).updateOffers({ id: (await riceOffer()).id, ...update })
      /** The rice's offer as the feed and the product page show it. */
      const riceAsShown = async () => {
        const grocery = await sellerId("Iya Bisi Foodstuff")
        const rice = await productId(RICE.title)
        const feed = (await list({ seller_id: grocery, limit: 100 })).data.listings.find((l: any) => l.product.id === rice)
        const page = (await detail(grocery, rice)).data.listing
        return [feed.offers[0].available_quantity, page.offers[0].available_quantity]
      }

      it("says how many are left: what is stocked less what is held for orders", async () => {
        await stockRice(10, 3)

        expect(await riceAsShown()).toEqual([7, 7])
      })

      it("still lists a sold-out offer, with none left", async () => {
        await stockRice(0)

        expect(await riceAsShown()).toEqual([0, 0])
      })

      it("leaves the count out when the shop doesn't track the offer's stock", async () => {
        await stockRice(0)
        await updateRice({ manage_inventory: false })

        expect(await riceAsShown()).toEqual([null, null])
      })

      it("leaves the count out when the offer can be ordered beyond its stock", async () => {
        await stockRice(0)
        await updateRice({ allow_backorder: true })

        expect(await riceAsShown()).toEqual([null, null])
      })

      it("counts every variant's offer on its own", async () => {
        const { data } = await list({ limit: 100 })
        const kaftan = data.listings.find((l: any) => l.product.title === KAFTAN.title)

        expect(kaftan.offers.map((o: any) => o.available_quantity)).toEqual(kaftan.offers.map(() => 50))
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
