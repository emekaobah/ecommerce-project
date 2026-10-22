import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MercurModules } from "@mercurjs/types"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PRODUCTS } from "../../src/scripts/seed-data"
import { fakeClerk } from "../helpers/clerk"

jest.setTimeout(5 * 60 * 1000)

const LANTERN = SEED_PRODUCTS.find((p) => p.title === "Rechargeable LED Lantern")!
const RICE = SEED_PRODUCTS.find((p) => p.title === "Ofada Rice 5kg")!

const clerk = fakeClerk()
// Set before the runner loads medusa-config, which registers the Clerk provider only when a key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey

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

    /** The shop's offer of a product (its first variant). */
    const offerId = async (shop: string, title: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: sellers } = await query.graph({ entity: "seller", fields: ["id"], filters: { name: shop } })
      const { data: products } = await query.graph({ entity: "product", fields: ["id"], filters: { title } })
      const { data: offers } = await query.graph({
        entity: "offer",
        fields: ["id"],
        filters: { seller_id: sellers[0].id, product_id: products[0].id },
      })
      return offers[0].id as string
    }

    const createCart = async () => (await api.post("/store/carts", { region_id: regionId }, { headers })).data.cart
    const addOffer = (cartId: string, offer: string, quantity = 1) =>
      api.post(`/store/carts/${cartId}/line-items`, { offer_id: offer, quantity }, { headers })
    const bySeller = async (cartId: string) => (await api.get(`/store/carts/${cartId}/sellers`, { headers })).data.cart

    describe("Multi-seller cart", () => {
      it("groups a cart holding two shops' offers into one group per shop, each item at its own shop's price", async () => {
        const cart = await createCart()
        await addOffer(cart.id, await offerId("Ikeja Gadget Hub", LANTERN.title))
        await addOffer(cart.id, await offerId("Iya Bisi Foodstuff", LANTERN.title))
        await addOffer(cart.id, await offerId("Iya Bisi Foodstuff", RICE.title), 2)

        const grouped = await bySeller(cart.id)

        expect(grouped).toMatchObject({ id: cart.id, currency_code: "ngn", item_count: 4 })
        const summary = grouped.sellers.map((g: any) => ({
          shop: g.seller.name,
          items: g.items.map((i: any) => [i.product_title, i.quantity, i.unit_price]),
          subtotal: g.item_subtotal,
        }))
        expect(summary).toEqual([
          { shop: "Ikeja Gadget Hub", items: [[LANTERN.title, 1, LANTERN.price]], subtotal: LANTERN.price },
          {
            shop: "Iya Bisi Foodstuff",
            items: [
              [LANTERN.title, 1, LANTERN.also_at![0].price],
              [RICE.title, 2, RICE.price],
            ],
            subtotal: LANTERN.also_at![0].price + 2 * RICE.price,
          },
        ])
        expect(grouped.item_subtotal).toBe(LANTERN.price + LANTERN.also_at![0].price + 2 * RICE.price)
      })

      it("shows each shop's logo and banner on its group, or nulls when it has none", async () => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data: shops } = await query.graph({ entity: "seller", fields: ["id", "name"] })
        const idOf = (name: string) => shops.find((s: any) => s.name === name)!.id
        const sellers = getContainer().resolve(MercurModules.SELLER) as any
        await sellers.updateSellers({ id: idOf("Ikeja Gadget Hub"), logo: "https://cdn.oja.test/logo.png", banner: "https://cdn.oja.test/banner.jpg" })
        await sellers.updateSellers({ id: idOf("Iya Bisi Foodstuff"), logo: null, banner: null })
        const cart = await createCart()
        await addOffer(cart.id, await offerId("Ikeja Gadget Hub", LANTERN.title))
        await addOffer(cart.id, await offerId("Iya Bisi Foodstuff", RICE.title))

        const grouped = await bySeller(cart.id)

        expect(Object.fromEntries(grouped.sellers.map((g: any) => [g.seller.name, [g.seller.logo, g.seller.banner]]))).toEqual({
          "Ikeja Gadget Hub": ["https://cdn.oja.test/logo.png", "https://cdn.oja.test/banner.jpg"],
          "Iya Bisi Foodstuff": [null, null],
        })
      })

      it("adds the same offer twice as one line", async () => {
        const cart = await createCart()
        const lantern = await offerId("Iya Bisi Foodstuff", LANTERN.title)
        await addOffer(cart.id, lantern)
        await addOffer(cart.id, lantern, 2)

        const [shop] = (await bySeller(cart.id)).sellers
        expect(shop.items.map((i: any) => [i.quantity, i.unit_price])).toEqual([[3, LANTERN.also_at![0].price]])
      })

      it("charges the shops' tax-inclusive prices, with no VAT added on top", async () => {
        const cart = await createCart()
        await addOffer(cart.id, await offerId("Ikeja Gadget Hub", LANTERN.title))
        await addOffer(cart.id, await offerId("Iya Bisi Foodstuff", RICE.title))

        const { data } = await api.get(`/store/carts/${cart.id}`, { headers })

        expect(data.cart.total).toBe(LANTERN.price + RICE.price)
      })

      it("keeps a quantity change, at the item's own shop's price", async () => {
        const cart = await createCart()
        await addOffer(cart.id, await offerId("Ikeja Gadget Hub", LANTERN.title))
        await addOffer(cart.id, await offerId("Iya Bisi Foodstuff", LANTERN.title))
        const dearer = (await bySeller(cart.id)).sellers[1].items[0]

        await api.post(`/store/carts/${cart.id}/line-items/${dearer.id}`, { quantity: 3 }, { headers })

        const grouped = await bySeller(cart.id)
        expect(grouped.sellers.map((g: any) => g.items.map((i: any) => [i.quantity, i.unit_price]))).toEqual([
          [[1, LANTERN.price]],
          [[3, LANTERN.also_at![0].price]],
        ])
        expect(grouped.item_count).toBe(4)
      })

      it("drops a removed item, and the shop's group with its last item", async () => {
        const cart = await createCart()
        await addOffer(cart.id, await offerId("Ikeja Gadget Hub", LANTERN.title))
        await addOffer(cart.id, await offerId("Iya Bisi Foodstuff", RICE.title))
        const [gadgets] = (await bySeller(cart.id)).sellers

        await api.delete(`/store/carts/${cart.id}/line-items/${gadgets.items[0].id}`, { headers })

        const grouped = await bySeller(cart.id)
        expect(grouped.sellers.map((g: any) => g.seller.name)).toEqual(["Iya Bisi Foodstuff"])
        expect(grouped).toMatchObject({ item_count: 1, item_subtotal: RICE.price })
      })

      it("is empty for a new cart", async () => {
        const cart = await createCart()

        expect(await bySeller(cart.id)).toMatchObject({ sellers: [], item_count: 0, item_subtotal: 0 })
      })

      it("keeps a guest's cart, items and prices when the buyer signs in", async () => {
        const cart = await createCart()
        await addOffer(cart.id, await offerId("Ikeja Gadget Hub", LANTERN.title))
        await addOffer(cart.id, await offerId("Iya Bisi Foodstuff", LANTERN.title))
        await addOffer(cart.id, await offerId("Iya Bisi Foodstuff", RICE.title), 2)
        const asGuest = await bySeller(cart.id)
        const signedIn = { headers: { ...headers, authorization: `Bearer ${clerk.sessionToken({ email: "ada@oja.test" })}` } }

        await api.post(`/store/carts/${cart.id}/customer`, {}, signedIn)

        const { data } = await api.get(`/store/carts/${cart.id}/sellers`, signedIn)
        const { data: me } = await api.get("/store/customers/me", signedIn)
        expect(data.cart.customer_id).toBe(me.customer.id)
        expect(data.cart.sellers).toEqual(asGuest.sellers)
      })

      it("is not found for an unknown cart", async () => {
        const res = await api.get("/store/carts/cart_missing/sellers", { headers }).catch((e) => e.response)

        expect(res.status).toBe(404)
      })
    })

    describe("stock", () => {
      /** Stocks the shop's offer of a product with `units`, at its one location. */
      const stock = async (offer: string, units: number) => {
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "offer",
          fields: ["inventory_item_link.inventory_item.location_levels.*"],
          filters: { id: offer },
        })
        const [level] = (data[0] as any).inventory_item_link[0].inventory_item.location_levels
        await getContainer()
          .resolve(Modules.INVENTORY)
          .updateInventoryLevels([
            { inventory_item_id: level.inventory_item_id, location_id: level.location_id, stocked_quantity: units },
          ])
      }

      it("says how many of each line's offer are left", async () => {
        const cart = await createCart()
        const rice = await offerId("Iya Bisi Foodstuff", RICE.title)
        await addOffer(cart.id, rice, 2)
        await stock(rice, 5)

        const [shop] = (await bySeller(cart.id)).sellers

        expect(shop.items.map((i: any) => [i.quantity, i.available_quantity])).toEqual([[2, 5]])
      })

      it("keeps a line that sold out, reported as sold out, with Medusa's totals unchanged", async () => {
        const cart = await createCart()
        const lantern = await offerId("Ikeja Gadget Hub", LANTERN.title)
        const rice = await offerId("Iya Bisi Foodstuff", RICE.title)
        await addOffer(cart.id, lantern)
        await addOffer(cart.id, rice, 2)
        const before = (await api.get(`/store/carts/${cart.id}`, { headers })).data.cart

        await stock(rice, 0)

        const grouped = await bySeller(cart.id)
        expect(
          grouped.sellers.map((g: any) => g.items.map((i: any) => [i.product_title, i.quantity, i.available_quantity]))
        ).toEqual([[[LANTERN.title, 1, 50]], [[RICE.title, 2, 0]]])
        expect(grouped).toMatchObject({ item_count: 3, item_subtotal: LANTERN.price + 2 * RICE.price })
        const after = (await api.get(`/store/carts/${cart.id}`, { headers })).data.cart
        expect([after.items.length, after.total]).toEqual([2, before.total])
      })

      it("tells a line wanting more than is left how many are left", async () => {
        const cart = await createCart()
        const rice = await offerId("Iya Bisi Foodstuff", RICE.title)
        await addOffer(cart.id, rice, 4)

        await stock(rice, 1)

        const [shop] = (await bySeller(cart.id)).sellers
        expect(shop.items.map((i: any) => [i.quantity, i.available_quantity])).toEqual([[4, 1]])
      })

      it("leaves the count out for an offer whose stock the shop doesn't track", async () => {
        const cart = await createCart()
        const rice = await offerId("Iya Bisi Foodstuff", RICE.title)
        await addOffer(cart.id, rice)
        await (getContainer().resolve(MercurModules.OFFER) as any).updateOffers({ id: rice, manage_inventory: false })

        const [shop] = (await bySeller(cart.id)).sellers

        expect(shop.items[0].available_quantity).toBeNull()
      })
    })

    describe("POST /store/carts/:id/merge", () => {
      const as = (email: string) => ({
        headers: { ...headers, authorization: `Bearer ${clerk.sessionToken({ sub: `user_${email}`, email })}` },
      })
      const buyerCart = async (email: string) =>
        (await api.post("/store/carts", { region_id: regionId }, as(email))).data.cart

      it("adds a guest cart's lines to the buyer's own cart, at each shop's price", async () => {
        const mine = await buyerCart("ada@oja.test")
        const ikejaLantern = await offerId("Ikeja Gadget Hub", LANTERN.title)
        await addOffer(mine.id, ikejaLantern)
        const guest = await createCart()
        await addOffer(guest.id, ikejaLantern, 2)
        await addOffer(guest.id, await offerId("Iya Bisi Foodstuff", LANTERN.title))

        const { data } = await api.post(`/store/carts/${mine.id}/merge`, { cart_id: guest.id }, as("ada@oja.test"))

        expect(data.cart.id).toBe(mine.id)
        expect(
          data.cart.sellers.map((g: any) => [g.seller.name, g.items.map((i: any) => [i.quantity, i.unit_price])])
        ).toEqual([
          ["Ikeja Gadget Hub", [[3, LANTERN.price]]],
          ["Iya Bisi Foodstuff", [[1, LANTERN.also_at![0].price]]],
        ])
      })

      it("needs a signed-in buyer", async () => {
        const mine = await createCart()
        const guest = await createCart()

        const res = await api.post(`/store/carts/${mine.id}/merge`, { cart_id: guest.id }, { headers }).catch((e) => e.response)

        expect(res.status).toBe(401)
      })

      it("won't merge into, or out of, another buyer's cart", async () => {
        const theirs = await buyerCart("bola@oja.test")
        await addOffer(theirs.id, await offerId("Iya Bisi Foodstuff", RICE.title))
        const mine = await buyerCart("ada@oja.test")
        const guest = await createCart()

        const into = await api
          .post(`/store/carts/${theirs.id}/merge`, { cart_id: guest.id }, as("ada@oja.test"))
          .catch((e) => e.response)
        const outOf = await api
          .post(`/store/carts/${mine.id}/merge`, { cart_id: theirs.id }, as("ada@oja.test"))
          .catch((e) => e.response)

        expect([into.status, outOf.status]).toEqual([404, 404])
        expect((await bySeller(theirs.id)).item_count).toBe(1)
      })
    })
  },
})
