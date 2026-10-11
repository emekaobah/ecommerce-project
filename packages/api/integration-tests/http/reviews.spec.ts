import { Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { SHOP_BANK_ACCOUNT_MODULE, type ShopBankAccountModuleService } from "../../src/modules/shop-bank-account"
import seedDemoData from "../../src/scripts/seed"
import { adminHeaders } from "../helpers/auth"
import { buyerCheckout, GADGETS, GROCERY, LANTERN, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

type RequestConfig = { headers: Record<string, string> }

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(57000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(59000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

// Reviews and ratings (#7): buyers review a shop's order once it is delivered; an operator
// moderates every review before other buyers see it; shops reply from the vendor panel.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    let admin: RequestConfig

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
      admin = await adminHeaders(getContainer(), api)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      await buyer.load()
    })

    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )
    const vendor = async (shop: Shop, path: string, body = {}) => api.post(`/vendor/${path}`, body, await buyer.owner(shop))
    const shipbubbleSays = (...args: Parameters<typeof shipbubble.webhook>) => {
      const { body, headers } = shipbubble.webhook(...args)
      return api.post("/hooks/shipbubble", body, { headers })
    }
    const productId = async (title: string) => {
      const { data } = await buyer.query().graph({ entity: "product", fields: ["id"], filters: { title } })
      return data[0].id as string
    }

    /** A new paid checkout of Ada's: the lantern from the gadget hub, rice from the grocery. */
    const paidOrders = async () => {
      const { cartId } = await buyer.paidCheckout()
      return { gadgets: await buyer.shopOrderId(GADGETS, cartId), grocery: await buyer.shopOrderId(GROCERY, cartId), cartId }
    }
    /** Takes the grocery's order all the way: accepted, picked, packed, handed to the courier and delivered. */
    const deliver = async (orderId: string) => {
      await vendor(GROCERY, `orders/${orderId}/accept`)
      await vendor(GROCERY, `orders/${orderId}/start-picking`)
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await buyer.owner(GROCERY))).data
      for (const line of pick_list.lines) await vendor(GROCERY, `orders/${orderId}/pick-list/${line.id}`, { picked: line.quantity })
      await vendor(GROCERY, `orders/${orderId}/pack`)
      const { data } = await vendor(GROCERY, `orders/${orderId}/book-label`)
      const waybill = data.fulfilment.shipment.waybill as string
      await shipbubbleSays(waybill, "confirmed")
      await vendor(GROCERY, `orders/${orderId}/hand-over`)
      await shipbubbleSays(waybill, "picked_up")
      await shipbubbleSays(waybill, "completed")
    }
    /** Ada's checkout, with the grocery's order of it delivered. */
    const deliveredGrocery = async () => {
      const orders = await paidOrders()
      await deliver(orders.grocery)
      return orders
    }

    const review = (body: Record<string, unknown>, as: RequestConfig = buyer.ada()) => api.post("/store/reviews", body, as)
    const reviewShop = async (orderId: string, shop: Shop, rating = 5, note: string | null = null, as: RequestConfig = buyer.ada()) =>
      (await review({ order_id: orderId, reference: "seller", reference_id: await buyer.sellerId(shop), rating, customer_note: note }, as))
        .data.review
    const reviewProduct = async (orderId: string, title: string, rating = 5, note: string | null = null) =>
      (await review({ order_id: orderId, reference: "product", reference_id: await productId(title), rating, customer_note: note }))
        .data.review

    describe("writing a review", () => {
      it("refuses a review of a shop's order that isn't delivered yet", async () => {
        const { gadgets, grocery } = await paidOrders()
        await vendor(GROCERY, `orders/${grocery}/accept`)

        expect(await status(reviewShop(gadgets, GADGETS))).toBe(400)
        expect(await status(reviewShop(grocery, GROCERY))).toBe(400)
        expect(await status(reviewProduct(grocery, RICE.title))).toBe(400)
      })

      it("takes a review of a delivered order's shop and of a product on it, pending moderation", async () => {
        const { grocery } = await deliveredGrocery()

        const shopReview = await reviewShop(grocery, GROCERY, 4, "Fresh and well packed")
        const productReview = await reviewProduct(grocery, RICE.title, 5)

        expect(shopReview).toMatchObject({ reference: "seller", rating: 4, customer_note: "Fresh and well packed", status: "pending" })
        expect(productReview).toMatchObject({ reference: "product", rating: 5, status: "pending" })
      })

      it("refuses a shop or product the delivered order didn't bring the buyer", async () => {
        const { grocery } = await deliveredGrocery()

        // The lantern came from the gadget hub, on the other shop's order of the checkout.
        expect(await status(reviewShop(grocery, GADGETS))).toBe(400)
        expect(await status(reviewProduct(grocery, LANTERN.title))).toBe(400)
      })

      it("refuses another buyer's order as not found, and a guest", async () => {
        const { grocery } = await deliveredGrocery()

        expect(await status(reviewShop(grocery, GROCERY, 5, null, buyer.as("ben@oja.test")))).toBe(404)
        expect(await status(reviewShop(grocery, GROCERY, 5, null, { headers: buyer.headers() }))).toBe(401)
      })

      it("takes one review of each shop and product per order", async () => {
        const { grocery } = await deliveredGrocery()
        await reviewShop(grocery, GROCERY)
        await reviewProduct(grocery, RICE.title)

        expect(await status(reviewShop(grocery, GROCERY))).toBe(400)
        expect(await status(reviewProduct(grocery, RICE.title))).toBe(400)
      })
    })

    const moderate = (reviewId: string, status: "published" | "rejected") =>
      api.post(`/admin/reviews/${reviewId}`, { status }, admin)
    const shopReviews = async (shop: Shop, query = "") =>
      (await api.get(`/store/sellers/${await buyer.sellerId(shop)}/reviews${query}`, { headers: buyer.headers() })).data
    const productReviews = async (title: string, query = "") =>
      (await api.get(`/store/products/${await productId(title)}/reviews${query}`, { headers: buyer.headers() })).data

    /** Two published reviews of the grocery, rated 5 then 2. */
    const twoPublishedShopReviews = async () => {
      const first = await deliveredGrocery()
      const second = await deliveredGrocery()
      const great = await reviewShop(first.grocery, GROCERY, 5, "Great")
      const poor = await reviewShop(second.grocery, GROCERY, 2, "Late")
      await moderate(great.id, "published")
      await moderate(poor.id, "published")
      return { first, second, great, poor }
    }

    // The database is back to the seeded shops before each test, so each sees only its own reviews.
    describe("the public reviews", () => {
      it("show a shop's and a product's published reviews only, newest first, with their average and count", async () => {
        const { first, second, great, poor } = await twoPublishedShopReviews()
        const third = await deliveredGrocery()
        const fourth = await deliveredGrocery()
        await reviewShop(third.grocery, GROCERY, 1, "Still waiting for moderation")
        const rejected = await reviewShop(fourth.grocery, GROCERY, 1, "Rude words")
        const rice = await reviewProduct(first.grocery, RICE.title, 4, "Good rice")
        await reviewProduct(second.grocery, RICE.title, 1)
        await moderate(rejected.id, "rejected")
        await moderate(rice.id, "published")

        const shop = await shopReviews(GROCERY)
        const product = await productReviews(RICE.title)

        expect(shop).toMatchObject({ count: 2, average_rating: 3.5 })
        expect(shop.reviews.map((r: any) => [r.id, r.rating, r.customer_note])).toEqual([
          [poor.id, 2, "Late"],
          [great.id, 5, "Great"],
        ])
        expect(product).toMatchObject({ count: 1, average_rating: 4 })
        expect(product.reviews).toEqual([
          { id: rice.id, rating: 4, customer_note: "Good rice", seller_note: null, author: "A buyer", created_at: expect.any(String) },
        ])
      })

      it("name a reviewer by first name and last initial only", async () => {
        const { great } = await twoPublishedShopReviews()
        const customers = getContainer().resolve(Modules.CUSTOMER)
        const [ada] = await customers.listCustomers({ email: "ada@oja.test" })
        await customers.updateCustomers(ada.id, { first_name: "Ada", last_name: "Lovelace" })

        const { reviews } = await shopReviews(GROCERY)

        expect(reviews.find((r: any) => r.id === great.id).author).toBe("Ada L.")
      })

      it("show no rating for a shop or product without published reviews", async () => {
        expect(await shopReviews(GADGETS)).toEqual({ reviews: [], average_rating: null, count: 0, offset: 0, limit: 10 })
        expect(await productReviews(LANTERN.title)).toMatchObject({ reviews: [], average_rating: null, count: 0 })
      })

      it("page through the reviews, the average and count of them all", async () => {
        await twoPublishedShopReviews()

        const page = await shopReviews(GROCERY, "?limit=1&offset=1")

        expect(page).toMatchObject({ count: 2, average_rating: 3.5, limit: 1, offset: 1 })
        expect(page.reviews.map((r: any) => r.rating)).toEqual([5])
      })

      it("are not found for a shop or product that doesn't exist", async () => {
        const guest = { headers: buyer.headers() }
        expect(await status(api.get("/store/sellers/sel_missing/reviews", guest))).toBe(404)
        expect(await status(api.get("/store/products/prod_missing/reviews", guest))).toBe(404)
      })

      it("are not found for a shop that isn't live (ADR 0007)", async () => {
        await twoPublishedShopReviews()
        const accounts = getContainer().resolve<ShopBankAccountModuleService>(SHOP_BANK_ACCOUNT_MODULE)
        const owned = await accounts.listShopBankAccounts({ seller_id: await buyer.sellerId(GROCERY) })
        await accounts.deleteShopBankAccounts(owned.map((a) => a.id))

        expect(await status(shopReviews(GROCERY))).toBe(404)
      })
    })
  },
})
