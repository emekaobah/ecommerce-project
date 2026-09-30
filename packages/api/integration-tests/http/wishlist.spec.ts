import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PRODUCTS } from "../../src/scripts/seed-data"
import { fakeClerk } from "../helpers/clerk"

jest.setTimeout(5 * 60 * 1000)

const LANTERN = SEED_PRODUCTS.find((p) => p.title === "Rechargeable LED Lantern")!
const RICE = SEED_PRODUCTS.find((p) => p.title === "Ofada Rice 5kg")!
const KAFTAN = SEED_PRODUCTS.find((p) => p.title === "Adire Kaftan")!

const clerk = fakeClerk()
// Set before the runner loads medusa-config, which registers the Clerk provider only when a key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let headers: Record<string, string>
    let regionId: string

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

    /** A signed-in buyer's request config. */
    const buyer = (email: string) => ({
      headers: { ...headers, authorization: `Bearer ${clerk.sessionToken({ sub: `user_${email}`, email })}` },
    })

    const ids = async (shop: string, title: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: sellers } = await query.graph({ entity: "seller", fields: ["id"], filters: { name: shop } })
      const { data: products } = await query.graph({ entity: "product", fields: ["id"], filters: { title } })
      const { data: offers } = await query.graph({
        entity: "offer",
        fields: ["id"],
        filters: { seller_id: sellers[0].id, product_id: products[0].id },
      })
      return { sellerId: sellers[0].id as string, productId: products[0].id as string, offerIds: offers.map((o: any) => o.id as string) }
    }

    const save = (as: object, sellerId: string, productId: string) =>
      api.post("/store/wishlist", { reference: "product", reference_id: productId, seller_id: sellerId }, as)
    const wishlist = async (as: object) => (await api.get(`/store/wishlist?region_id=${regionId}`, as)).data.items
    const summary = (items: any[]) =>
      items.map((i) => ({ shop: i.listing?.seller.name, title: i.product.title, price: i.listing?.offers[0].calculated_price.calculated_amount }))

    describe("saving", () => {
      it("saves a shop's product, lists it as that shop's listing, newest first, and removes it", async () => {
        const ada = buyer("ada@oja.test")
        const lantern = await ids("Iya Bisi Foodstuff", LANTERN.title)
        const rice = await ids("Iya Bisi Foodstuff", RICE.title)

        expect((await save(ada, lantern.sellerId, lantern.productId)).status).toBe(201)
        await save(ada, rice.sellerId, rice.productId)

        // The lantern at the shop it was saved from, at that shop's price, never the cheaper shop's.
        expect(summary(await wishlist(ada))).toEqual([
          { shop: "Iya Bisi Foodstuff", title: RICE.title, price: RICE.price },
          { shop: "Iya Bisi Foodstuff", title: LANTERN.title, price: LANTERN.also_at![0].price },
        ])

        await api.delete(`/store/wishlist/product/${rice.productId}`, ada)
        expect(summary(await wishlist(ada))).toEqual([
          { shop: "Iya Bisi Foodstuff", title: LANTERN.title, price: LANTERN.also_at![0].price },
        ])
      })

      it("keeps a product once, at the shop it was last saved from", async () => {
        const ada = buyer("ada@oja.test")
        const atGrocer = await ids("Iya Bisi Foodstuff", LANTERN.title)
        const atGadgets = await ids("Ikeja Gadget Hub", LANTERN.title)

        await save(ada, atGrocer.sellerId, atGrocer.productId)
        await save(ada, atGadgets.sellerId, atGadgets.productId)

        expect(summary(await wishlist(ada))).toEqual([{ shop: "Ikeja Gadget Hub", title: LANTERN.title, price: LANTERN.price }])
      })

      it("shows an empty wishlist to a buyer who hasn't saved anything, and keeps each buyer's to themselves", async () => {
        const rice = await ids("Iya Bisi Foodstuff", RICE.title)
        await save(buyer("ada@oja.test"), rice.sellerId, rice.productId)

        expect(await wishlist(buyer("bola@oja.test"))).toEqual([])
      })

      it("refuses a product the shop doesn't sell", async () => {
        const rice = await ids("Iya Bisi Foodstuff", RICE.title)
        const gadgets = await ids("Ikeja Gadget Hub", LANTERN.title)

        const error = await save(buyer("ada@oja.test"), gadgets.sellerId, rice.productId).catch((e) => e.response)

        expect(error.status).toBe(404)
      })

      it("asks a guest to sign in", async () => {
        const rice = await ids("Iya Bisi Foodstuff", RICE.title)

        const saving = await save({ headers }, rice.sellerId, rice.productId).catch((e) => e.response)
        const listing = await api.get(`/store/wishlist?region_id=${regionId}`, { headers }).catch((e) => e.response)

        expect(saving.status).toBe(401)
        expect(listing.status).toBe(401)
      })
    })

    describe("moving to the cart", () => {
      const createCart = async (as: object) => (await api.post("/store/carts", { region_id: regionId }, as)).data.cart

      it("adds the saved shop's offer to the cart, keeps the cart grouped by shop, and takes it off the wishlist", async () => {
        const ada = buyer("ada@oja.test")
        const cart = await createCart(ada)
        const rice = await ids("Iya Bisi Foodstuff", RICE.title)
        await api.post(`/store/carts/${cart.id}/line-items`, { offer_id: rice.offerIds[0], quantity: 1 }, ada)
        const lantern = await ids("Ikeja Gadget Hub", LANTERN.title)
        await save(ada, lantern.sellerId, lantern.productId)

        const { data } = await api.post(`/store/wishlist/product/${lantern.productId}/cart`, { cart_id: cart.id }, ada)

        expect(
          data.cart.sellers.map((g: any) => ({ shop: g.seller.name, items: g.items.map((i: any) => [i.product_title, i.unit_price]) }))
        ).toEqual([
          { shop: "Iya Bisi Foodstuff", items: [[RICE.title, RICE.price]] },
          { shop: "Ikeja Gadget Hub", items: [[LANTERN.title, LANTERN.price]] },
        ])
        expect(await wishlist(ada)).toEqual([])
      })

      it("asks which one when the product comes in several sizes, and moves the one chosen", async () => {
        const ada = buyer("ada@oja.test")
        const cart = await createCart(ada)
        const kaftan = await ids("Adire House", KAFTAN.title)
        await save(ada, kaftan.sellerId, kaftan.productId)

        const unchosen = await api
          .post(`/store/wishlist/product/${kaftan.productId}/cart`, { cart_id: cart.id }, ada)
          .catch((e) => e.response)
        expect(unchosen.status).toBe(400)

        const { data } = await api.post(
          `/store/wishlist/product/${kaftan.productId}/cart`,
          { cart_id: cart.id, offer_id: kaftan.offerIds[1] },
          ada
        )
        expect(data.cart.sellers[0].items).toEqual([expect.objectContaining({ product_title: KAFTAN.title, quantity: 1 })])
      })

      it("won't move a product into another buyer's cart", async () => {
        const bolasCart = await createCart(buyer("bola@oja.test"))
        const ada = buyer("ada@oja.test")
        const rice = await ids("Iya Bisi Foodstuff", RICE.title)
        await save(ada, rice.sellerId, rice.productId)

        const error = await api
          .post(`/store/wishlist/product/${rice.productId}/cart`, { cart_id: bolasCart.id }, ada)
          .catch((e) => e.response)

        expect(error.status).toBe(404)
        expect(await wishlist(ada)).toHaveLength(1)
      })
    })
  },
})
