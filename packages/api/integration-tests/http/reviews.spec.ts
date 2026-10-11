import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import seedDemoData from "../../src/scripts/seed"
import { adminHeaders } from "../helpers/auth"
import { buyerCheckout, GADGETS, GROCERY, LANTERN, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

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
    let admin: { headers: Record<string, string> }

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

    const review = (body: Record<string, unknown>, as = buyer.ada()) => api.post("/store/reviews", body, as)
    const reviewShop = async (orderId: string, shop: Shop, rating = 5, note: string | null = null, as = buyer.ada()) =>
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
  },
})
