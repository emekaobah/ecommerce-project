import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import seedDemoData from "../../src/scripts/seed"
import { buyerCheckout, GADGETS, GROCERY, LANTERN, RICE } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so the fake can be named in the config before it is listening.
const paystack = fakePaystack(50000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl

// The buyer's order history (#17): each checkout is an order group, split into an order per shop.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })

    beforeAll(async () => {
      await paystack.start()
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => paystack.stop())
    beforeEach(() => buyer.load())

    /** Ada's paid checkout: its order group, and each shop's order of it. */
    const paidGroup = async () => {
      const { cartId, reference } = await buyer.paidCheckout()
      return {
        reference,
        groupId: await buyer.orderGroupOf(cartId),
        gadgets: await buyer.shopOrderId(GADGETS, cartId),
        grocery: await buyer.shopOrderId(GROCERY, cartId),
      }
    }
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )
    const history = async (as = buyer.ada()) => (await api.get("/store/order-history", as)).data.order_groups

    const orderGroup = async (id: string, as = buyer.ada()) => (await api.get(`/store/order-history/${id}`, as)).data.order_group

    describe("the order list", () => {
      it("lists the buyer's order groups newest first, each split into its shops' orders and their items", async () => {
        const first = await paidGroup()
        const second = await paidGroup()

        const groups = await history()

        const ids = groups.map((g: any) => g.id)
        expect(ids.indexOf(second.groupId)).toBeLessThan(ids.indexOf(first.groupId))
        expect(ids.indexOf(first.groupId)).toBeGreaterThan(-1)
        const latest = groups.find((g: any) => g.id === second.groupId)
        const items = Object.fromEntries(
          latest.orders.map((o: any) => [o.seller.name, o.items.map((i: any) => [i.product_title, i.quantity])])
        )
        expect(items).toEqual({
          [GADGETS.name]: [[LANTERN.title, 1]],
          [GROCERY.name]: [[RICE.title, 2]],
        })
      })

      it("shows a buyer only their own order groups, and a guest none", async () => {
        const { groupId } = await paidGroup()

        const bens = await history(buyer.as("ben@oja.test"))

        expect(bens.map((g: any) => g.id)).not.toContain(groupId)
        expect(await status(api.get("/store/order-history", { headers: buyer.headers() }))).toBe(401)
      })
    })

    describe("an order group", () => {
      it("shows each shop's order with its items", async () => {
        const { groupId, gadgets, grocery } = await paidGroup()

        const group = await orderGroup(groupId)

        expect(group.id).toBe(groupId)
        const byShop = Object.fromEntries(group.orders.map((o: any) => [o.seller.name, o]))
        expect(byShop[GADGETS.name]).toMatchObject({ id: gadgets, items: [{ product_title: LANTERN.title, quantity: 1, unit_price: LANTERN.price }] })
        expect(byShop[GROCERY.name]).toMatchObject({ id: grocery, items: [{ product_title: RICE.title, quantity: 2, unit_price: RICE.price }] })
      })

      it("is not found for any other buyer, or a guest", async () => {
        const { groupId } = await paidGroup()

        expect(await status(api.get(`/store/order-history/${groupId}`, buyer.as("ben@oja.test")))).toBe(404)
        expect(await status(api.get(`/store/order-history/${groupId}`, { headers: buyer.headers() }))).toBe(401)
      })
    })
  },
})
