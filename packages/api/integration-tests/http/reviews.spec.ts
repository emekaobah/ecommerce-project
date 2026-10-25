import { Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { SHOP_BANK_ACCOUNT_MODULE, type ShopBankAccountModuleService } from "../../src/modules/shop-bank-account"
import { seedDemoWorld } from "../../src/scripts/seed"
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
    // A buyer reviews each shop and product once, so ratings of several reviews need several buyers.
    const [ben, chi, dee] = ["ben", "chi", "dee"].map((name) =>
      buyerCheckout({ api, getContainer, clerk, paystack, email: `${name}@oja.test` })
    )
    type Buyer = typeof buyer
    let admin: RequestConfig

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
      admin = await adminHeaders(getContainer(), api)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      await Promise.all([buyer, ben, chi, dee].map((b) => b.load()))
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

    /** A new paid checkout of the buyer's (Ada's by default): the lantern from the gadget hub, rice from the grocery. */
    const paidOrders = async (who: Buyer = buyer) => {
      const { cartId } = await who.paidCheckout()
      return { gadgets: await who.shopOrderId(GADGETS, cartId), grocery: await who.shopOrderId(GROCERY, cartId), cartId }
    }
    /** Takes the grocery's order all the way: accepted, picked, packed, handed to the courier and delivered. */
    const deliver = async (orderId: string) => {
      await vendor(GROCERY, `orders/${orderId}/accept`)
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
    /** The buyer's (Ada's by default) checkout, with the grocery's order of it delivered. */
    const deliveredGrocery = async (who: Buyer = buyer) => {
      const orders = await paidOrders(who)
      await deliver(orders.grocery)
      return orders
    }

    const review = (body: Record<string, unknown>, as: RequestConfig = buyer.ada()) => api.post("/store/reviews", body, as)
    const reviewShop = async (orderId: string, shop: Shop, rating = 5, note: string | null = null, as: RequestConfig = buyer.ada()) =>
      (await review({ order_id: orderId, reference: "seller", reference_id: await buyer.sellerId(shop), rating, customer_note: note }, as))
        .data.review
    const reviewProduct = async (
      orderId: string,
      title: string,
      rating = 5,
      note: string | null = null,
      as: RequestConfig = buyer.ada()
    ) =>
      (await review({ order_id: orderId, reference: "product", reference_id: await productId(title), rating, customer_note: note }, as))
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

      it("takes one review of each shop and product per buyer, whatever the order, and points them to edit it", async () => {
        const first = await deliveredGrocery()
        const later = await deliveredGrocery()
        await reviewShop(first.grocery, GROCERY)
        await reviewProduct(first.grocery, RICE.title)

        const refusal = (attempt: Promise<unknown>) => attempt.then(() => undefined, (e: any) => e.response)
        const refusals = [
          await refusal(reviewShop(first.grocery, GROCERY)),
          await refusal(reviewShop(later.grocery, GROCERY)),
          await refusal(reviewProduct(later.grocery, RICE.title)),
        ]

        for (const refused of refusals) {
          expect(refused?.status).toBe(400)
          expect(refused?.data.message).toMatch(/edit your review/i)
        }
      })
    })

    const moderate = (reviewId: string, status: "published" | "rejected") =>
      api.post(`/admin/reviews/${reviewId}`, { status }, admin)
    const shopReviews = async (shop: Shop, query = "") =>
      (await api.get(`/store/sellers/${await buyer.sellerId(shop)}/reviews${query}`, { headers: buyer.headers() })).data
    const productReviews = async (title: string, query = "") =>
      (await api.get(`/store/products/${await productId(title)}/reviews${query}`, { headers: buyer.headers() })).data

    /** Two published reviews of the grocery: Ada's rated 5, then Ben's rated 2. */
    const twoPublishedShopReviews = async () => {
      const first = await deliveredGrocery()
      const second = await deliveredGrocery(ben)
      const great = await reviewShop(first.grocery, GROCERY, 5, "Great")
      const poor = await reviewShop(second.grocery, GROCERY, 2, "Late", ben.ada())
      await moderate(great.id, "published")
      await moderate(poor.id, "published")
      return { first, second, great, poor }
    }

    // The database is back to the seeded shops before each test, so each sees only its own reviews.
    describe("the public reviews", () => {
      it("show a shop's and a product's published reviews only, newest first, with their average and count", async () => {
        const { first, second, great, poor } = await twoPublishedShopReviews()
        const third = await deliveredGrocery(chi)
        const fourth = await deliveredGrocery(dee)
        await reviewShop(third.grocery, GROCERY, 1, "Still waiting for moderation", chi.ada())
        const rejected = await reviewShop(fourth.grocery, GROCERY, 1, "Rude words", dee.ada())
        const rice = await reviewProduct(first.grocery, RICE.title, 4, "Good rice")
        await reviewProduct(second.grocery, RICE.title, 1, null, ben.ada())
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
          {
            id: rice.id,
            rating: 4,
            customer_note: "Good rice",
            seller_note: null,
            author: "A buyer",
            shop: { id: await buyer.sellerId(GROCERY), name: GROCERY.name },
            created_at: expect.any(String),
          },
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

    describe("the buyer's order", () => {
      const groceryOrder = async (cartId: string, orderId: string) => {
        const { data } = await api.get(`/store/order-history/${await buyer.orderGroupOf(cartId)}`, buyer.ada())
        return data.order_group.orders.find((o: any) => o.id === orderId)
      }

      it("can be reviewed once delivered, and shows its author their review waiting for moderation, then published with the shop's reply", async () => {
        const { cartId, grocery } = await paidOrders()
        const before = await groceryOrder(cartId, grocery)
        await deliver(grocery)
        const delivered = await groceryOrder(cartId, grocery)
        const shopReview = await reviewShop(grocery, GROCERY, 4, "Fresh")
        // The shop may reply straight away, but its reply shows only once the review is published.
        await vendor(GROCERY, `reviews/${shopReview.id}`, { seller_note: "Thank you!" })
        const pending = await groceryOrder(cartId, grocery)
        await moderate(shopReview.id, "published")
        const published = await groceryOrder(cartId, grocery)

        expect(before).toMatchObject({ can_review: false, reviews: [] })
        expect(delivered).toMatchObject({ can_review: true, reviews: [] })
        expect(pending.reviews).toEqual([
          {
            id: shopReview.id,
            reference: "seller",
            reference_id: await buyer.sellerId(GROCERY),
            rating: 4,
            customer_note: "Fresh",
            seller_note: null,
            status: "pending",
          },
        ])
        expect(published.reviews).toEqual([
          expect.objectContaining({ id: shopReview.id, status: "published", seller_note: "Thank you!" }),
        ])
      })
    })

    describe("a later order", () => {
      it("shows the buyer's review of its shop or product from an earlier order, to edit rather than write again", async () => {
        const first = await deliveredGrocery()
        const shopReview = await reviewShop(first.grocery, GROCERY, 4, "Fresh")
        const later = await deliveredGrocery()

        const { data } = await api.get(`/store/order-history/${await buyer.orderGroupOf(later.cartId)}`, buyer.ada())
        const order = data.order_group.orders.find((o: any) => o.id === later.grocery)

        expect(order.can_review).toBe(true)
        expect(order.reviews).toEqual([
          expect.objectContaining({ id: shopReview.id, reference: "seller", rating: 4, status: "pending" }),
        ])
      })
    })

    // The Account screen's "My reviews · 3 reviews · 1 order to review" (#73).
    describe("the account summary", () => {
      it("counts the reviews the buyer wrote, and their received orders with something still to review", async () => {
        const counts = async (who: Buyer = buyer) => {
          const { summary } = (await api.get("/store/customers/me/summary", who.ada())).data
          return [summary.reviews_written, summary.orders_to_review]
        }
        // Two checkouts, each with the grocery's order delivered and the gadget hub's not yet.
        const first = await deliveredGrocery()
        await deliveredGrocery()

        const received = await counts()
        await reviewShop(first.grocery, GROCERY)
        // Both grocery orders still have the rice to review.
        const shopReviewed = await counts()
        // One review of each shop and product, whichever order: the later order has nothing left either.
        await reviewProduct(first.grocery, RICE.title)

        expect([received, shopReviewed, await counts()]).toEqual([
          [0, 2],
          [1, 2],
          [2, 0],
        ])
        expect(await counts(ben)).toEqual([0, 0])
      })
    })

    describe("the buyer's own reviews", () => {
      it("hide the shop's reply until the review is published", async () => {
        const { grocery } = await deliveredGrocery()
        const pending = await reviewShop(grocery, GROCERY, 4, "Fresh")
        await vendor(GROCERY, `reviews/${pending.id}`, { seller_note: "Thank you!" })
        const replyOf = async () => {
          const { data: list } = await api.get("/store/reviews", buyer.ada())
          const { data: one } = await api.get(`/store/reviews/${pending.id}`, buyer.ada())
          return [list.reviews.find((r: any) => r.id === pending.id).seller_note, one.review.seller_note]
        }

        const before = await replyOf()
        await moderate(pending.id, "published")
        const after = await replyOf()

        expect(before).toEqual([null, null])
        expect(after).toEqual(["Thank you!", "Thank you!"])
      })

      it("name the shop a product review's product was bought from (#96)", async () => {
        const { grocery } = await deliveredGrocery()
        const productReview = await reviewProduct(grocery, RICE.title, 5)
        const shopReview = await reviewShop(grocery, GROCERY, 4)

        const withShop = { ...buyer.ada(), params: { fields: "+shop.name" } }
        const { data: list } = await api.get("/store/reviews", withShop)
        const { data: one } = await api.get(`/store/reviews/${productReview.id}`, withShop)
        const shopOf = (id: string) => list.reviews.find((r: any) => r.id === id).shop

        expect(shopOf(productReview.id)).toMatchObject({ name: GROCERY.name })
        expect(shopOf(shopReview.id)).toMatchObject({ name: GROCERY.name })
        expect(one.review.shop).toMatchObject({ name: GROCERY.name })
      })
    })

    describe("moderation", () => {
      it("shows the shop's reply under its review once the review is published", async () => {
        const { grocery } = await deliveredGrocery()
        const pending = await reviewShop(grocery, GROCERY, 3, "Rice was fine, bag was torn")

        await vendor(GROCERY, `reviews/${pending.id}`, { seller_note: "Sorry about the bag, we've changed supplier" })
        const before = await shopReviews(GROCERY)
        await moderate(pending.id, "published")
        const after = await shopReviews(GROCERY)

        expect(before.reviews).toEqual([])
        expect(after.reviews).toEqual([
          expect.objectContaining({ id: pending.id, seller_note: "Sorry about the bag, we've changed supplier" }),
        ])
      })

      it("sends a review its author edits back to moderation", async () => {
        const { great } = await twoPublishedShopReviews()

        const { data } = await api.post(`/store/reviews/${great.id}`, { rating: 1, customer_note: "Changed my mind" }, buyer.ada())

        expect(data.review).toMatchObject({ rating: 1, customer_note: "Changed my mind", status: "pending" })
        expect((await shopReviews(GROCERY)).reviews.map((r: any) => r.id)).not.toContain(great.id)
      })
    })
  },
})
