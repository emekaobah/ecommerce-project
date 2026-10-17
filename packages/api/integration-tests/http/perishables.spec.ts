import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { adminHeaders } from "../helpers/auth"
import { ADDRESS, buyerCheckout, GADGETS, GROCERY, LANTERN, RETURN_URL, RICE } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { COURIERS, fakeShipbubble, type FakeCourier } from "../helpers/shipbubble"
import { keepShopsOpen } from "../helpers/shop-hours"
import { SEED_PERISHABLE_CATEGORIES, SEED_PRODUCTS } from "../../src/scripts/seed-data"
import seedDemoData from "../../src/scripts/seed"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
const paystack = fakePaystack(55000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(57000 + (process.pid % 1000))
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

const TOMATOES = SEED_PRODUCTS.find((p) => p.category === SEED_PERISHABLE_CATEGORIES[0])!

/** Couriers arriving at set times of day, so "by the end of tomorrow" doesn't depend on when the test runs. */
const courier = (id: string, amount: number, day: number, at: string): FakeCourier => ({
  ...COURIERS.bike,
  courier_id: id,
  courier_name: id,
  service_code: id,
  amount,
  arrives: { day, at },
})
const TODAY = courier("Same Day", 5000, 0, "20:00:00")
// Within a day of Same Day for less: best value.
const TOMORROW = courier("Tomorrow", 3000, 1, "18:00:00")
const LATER = courier("Later", 1500, 2, "09:00:00")

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const { ada, offerId, owner, sellerId } = buyer
    let admin: { headers: Record<string, string> }

    const productId = async (title: string) => {
      const { data } = await buyer.query().graph({ entity: "product", fields: ["id"], filters: { title } })
      return data[0].id as string
    }
    const categoryId = async (name: string) => {
      const { data } = await buyer.query().graph({ entity: "product_category", fields: ["id"], filters: { name } })
      return data[0].id as string
    }
    /** Whether the product page shows the product as perishable. */
    const listedPerishable = async (shop: typeof GROCERY, title: string) => {
      const { data } = await api.get(
        `/store/listings/${await sellerId(shop)}/${await productId(title)}?region_id=${buyer.regionId()}`,
        { headers: buyer.headers() }
      )
      return data.listing.product.perishable as boolean
    }
    const flagCategory = async (name: string, perishable: boolean) =>
      api.post(`/admin/product-categories/${await categoryId(name)}/perishable`, { perishable }, admin)
    const overrideProduct = async (title: string, override: boolean | null) =>
      api.post(`/admin/products/${await productId(title)}/perishable`, { override }, admin)

    /** A cart of tomatoes from the grocery shop and a lantern from the gadget hub. */
    const freshCart = async () => {
      const { data } = await api.post("/store/carts", { region_id: buyer.regionId() }, ada())
      const cartId = data.cart.id as string
      await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, TOMATOES.title), quantity: 1 }, ada())
      await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GADGETS, LANTERN.title), quantity: 1 }, ada())
      return cartId
    }
    const shopIn = async (checkout: any, shop: typeof GROCERY) => {
      const id = await sellerId(shop)
      return checkout.sellers.find((g: any) => g.seller.id === id)
    }

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
      // Delivery counts from the shops' next opening (ADR 0004); open round the clock, it counts from now.
      await keepShopsOpen(getContainer(), [GADGETS, GROCERY])
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      await buyer.load()
      admin = await adminHeaders(getContainer(), api)
    })

    describe("the perishable flag", () => {
      afterEach(async () => {
        await flagCategory("Rice & Grains", false)
        await flagCategory("Groceries", false)
        await overrideProduct(RICE.title, null)
        await overrideProduct(TOMATOES.title, null)
      })

      it("is seeded on fresh and chilled grocery categories, and their products inherit it", async () => {
        for (const name of SEED_PERISHABLE_CATEGORIES) {
          const { data } = await api.get(`/admin/product-categories/${await categoryId(name)}/perishable`, admin)
          expect(data.perishable).toMatchObject({ perishable: true })
        }
        expect(await listedPerishable(GROCERY, TOMATOES.title)).toBe(true)
        expect(await listedPerishable(GROCERY, RICE.title)).toBe(false)
      })

      it("is inherited by a product from its category, and from its category's parent", async () => {
        await flagCategory("Rice & Grains", true)
        expect(await listedPerishable(GROCERY, RICE.title)).toBe(true)

        await flagCategory("Rice & Grains", false)
        await flagCategory("Groceries", true)
        expect(await listedPerishable(GROCERY, RICE.title)).toBe(true)
        const { data } = await api.get(`/admin/products/${await productId(RICE.title)}/perishable`, admin)
        expect(data.perishable).toEqual({ perishable: true, override: null, inherited: true })
      })

      it("is overridden per product by the operator, either way, until the override is cleared", async () => {
        await flagCategory("Rice & Grains", true)
        const { data } = await overrideProduct(RICE.title, false)
        expect(data.perishable).toEqual({ perishable: false, override: false, inherited: true })
        expect(await listedPerishable(GROCERY, RICE.title)).toBe(false)

        await overrideProduct(TOMATOES.title, false)
        expect(await listedPerishable(GROCERY, TOMATOES.title)).toBe(false)
        await flagCategory("Rice & Grains", false)
        await overrideProduct(RICE.title, true)
        expect(await listedPerishable(GROCERY, RICE.title)).toBe(true)

        await overrideProduct(RICE.title, null)
        expect(await listedPerishable(GROCERY, RICE.title)).toBe(false)
      })

      it("can't be changed through the vendor routes", async () => {
        const shop = await owner(GROCERY)
        const tomatoes = await productId(TOMATOES.title)
        const category = await categoryId(SEED_PERISHABLE_CATEGORIES[0])

        // The flags' only routes are the operator's.
        const routes = [
          api.post(`/admin/products/${tomatoes}/perishable`, { override: false }, shop),
          api.post(`/admin/product-categories/${category}/perishable`, { perishable: false }, shop),
        ]
        for (const res of await Promise.all(routes.map((r) => r.catch((e) => e.response)))) {
          expect(res.status).toBe(401)
        }
        // The shop's own product edit is taken (as a change for the operator to review), with
        // metadata and custom-field data that say nothing about it.
        const edit = await api
          .post(
            `/vendor/products/${tomatoes}`,
            { metadata: { perishable: false }, additional_data: { perishable: false } },
            shop
          )
          .catch((e) => e.response)
        expect([200, 202]).toContain(edit.status)

        expect(await listedPerishable(GROCERY, TOMATOES.title)).toBe(true)
      })

      it("marks perishable lines in the cart", async () => {
        const cartId = await freshCart()

        const { data } = await api.get(`/store/carts/${cartId}/sellers`, { headers: buyer.headers() })

        const lines = data.cart.sellers.flatMap((g: any) => g.items.map((i: any) => [i.product_title, i.perishable]))
        expect(lines).toEqual([
          [TOMATOES.title, true],
          [LANTERN.title, false],
        ])
      })
    })

    describe("delivering perishables", () => {
      beforeEach(() => shipbubble.setCouriers([TODAY, TOMORROW, LATER]))

      it("offers a shop's order with a perishable line only rates delivering by the end of tomorrow, and the other shop every rate", async () => {
        const cartId = await freshCart()

        const { data } = await buyer.prepare(cartId)

        const grocery = await shopIn(data.checkout, GROCERY)
        expect(grocery.perishable).toBe(true)
        expect(grocery.delivery_unavailable).toBeNull()
        expect(grocery.delivery_choices.map((c: any) => [c.courier_name, c.tags])).toEqual([
          ["Tomorrow", ["best_value", "cheapest"]],
          ["Same Day", ["fastest"]],
        ])
        expect(grocery.shipping).toMatchObject({ name: "Tomorrow", amount: TOMORROW.amount })

        const gadgets = await shopIn(data.checkout, GADGETS)
        expect(gadgets.perishable).toBe(false)
        expect(gadgets.delivery_choices.map((c: any) => c.courier_name).sort()).toEqual(["Later", "Same Day", "Tomorrow"])
        expect(data.checkout.ready_to_pay).toBe(true)
      })

      it("makes delivery unavailable for that shop's order, with a reason, when no rate arrives in time", async () => {
        shipbubble.setCouriers([LATER])
        const cartId = await freshCart()

        const { data } = await buyer.prepare(cartId)

        const grocery = await shopIn(data.checkout, GROCERY)
        expect(grocery.shipping).toBeNull()
        expect(grocery.delivery_choices).toEqual([])
        expect(grocery.delivery_unavailable).toEqual({
          code: "perishable_too_slow",
          reason: expect.stringMatching(/fresh|perishable/i),
        })
        // The other shop still delivers.
        const gadgets = await shopIn(data.checkout, GADGETS)
        expect(gadgets.delivery_unavailable).toBeNull()
        expect(gadgets.shipping).toMatchObject({ name: "Later" })
        expect(data.checkout.ready_to_pay).toBe(false)
        expect(data.checkout.shipping_total).toBe(LATER.amount)

        // It says so when the checkout is read again, and payment won't start.
        const again = await buyer.checkout(cartId)
        expect((await shopIn(again, GROCERY)).delivery_unavailable).toEqual(grocery.delivery_unavailable)
        const res = await api
          .post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())
          .catch((e) => e.response)
        expect(res.status).toBe(400)
      })

      it("drops a shop's earlier delivery once a perishable line it can't deliver in time joins the order", async () => {
        shipbubble.setCouriers([LATER])
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, TOMATOES.title), quantity: 1 }, ada())

        const { data } = await buyer.prepare(cartId)

        expect((await shopIn(data.checkout, GROCERY)).delivery_unavailable).not.toBeNull()
        expect(data.checkout.shipping_total).toBe(LATER.amount)
      })

      it("won't take a delivery quoted before the order became perishable, nor keep refusing once it isn't", async () => {
        shipbubble.setCouriers([LATER])
        const cartId = await buyer.adasCart()
        await buyer.prepare(cartId)
        expect((await buyer.checkout(cartId)).ready_to_pay).toBe(true)

        await flagCategory("Rice & Grains", true)
        try {
          const flagged = await buyer.checkout(cartId)
          expect((await shopIn(flagged, GROCERY)).shipping).toBeNull()
          expect(flagged.ready_to_pay).toBe(false)
          const res = await api
            .post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())
            .catch((e) => e.response)
          expect(res.status).toBe(400)

          const { data } = await buyer.prepare(cartId)
          expect((await shopIn(data.checkout, GROCERY)).delivery_unavailable).not.toBeNull()
        } finally {
          await flagCategory("Rice & Grains", false)
        }
        // Unflagged, the old refusal no longer stands: checkout quotes the shop again.
        expect((await shopIn(await buyer.checkout(cartId), GROCERY)).delivery_unavailable).toBeNull()
      })

      it("quotes every rate again once the perishable line is removed", async () => {
        shipbubble.setCouriers([LATER])
        const cartId = await freshCart()
        await buyer.prepare(cartId)
        const { data: cart } = await api.get(`/store/carts/${cartId}/sellers`, { headers: buyer.headers() })
        const tomatoes = cart.cart.sellers.flatMap((g: any) => g.items).find((i: any) => i.product_title === TOMATOES.title)
        await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, RICE.title), quantity: 1 }, ada())
        await api.delete(`/store/carts/${cartId}/line-items/${tomatoes.id}`, ada())

        const { data } = await buyer.prepare(cartId)

        const grocery = await shopIn(data.checkout, GROCERY)
        expect(grocery.perishable).toBe(false)
        expect(grocery.delivery_unavailable).toBeNull()
        expect(grocery.shipping).toMatchObject({ name: "Later" })
        expect(data.checkout.ready_to_pay).toBe(true)
      })

      it("estimates a perishable product's delivery on the product page only from rates arriving in time", async () => {
        const bola = buyer.as("bola@oja.test")
        await api.post("/store/customers/me/addresses", { ...ADDRESS, first_name: "Bola" }, bola)
        const estimate = async (title: string) => {
          const { data } = await api.get(
            `/store/listings/${await sellerId(GROCERY)}/${await productId(title)}/delivery-estimate?region_id=${buyer.regionId()}`,
            bola
          )
          return data.estimate
        }

        expect((await estimate(TOMATOES.title))?.courier_name).toBe("Tomorrow")
        shipbubble.setCouriers([LATER])
        expect(await estimate(TOMATOES.title)).toBeNull()
        expect((await estimate(RICE.title))?.courier_name).toBe("Later")
      })
    })
  },
})
