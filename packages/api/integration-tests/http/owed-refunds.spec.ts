import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import seedDemoData from "../../src/scripts/seed"
import { adminHeaders } from "../helpers/auth"
import { buyerCheckout, GROCERY, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(36000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(37000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

const ADA = "ada@oja.test"
const BALANCE = "Insufficient balance"

// A refund Paystack refuses is owed to the buyer until it is made: retried with backoff, then
// handed to Oja's team, who can retry it or mark it settled by hand (#16).
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const status = (request: Promise<unknown>) =>
      request.then(
        () => 200,
        (e: any) => e.response?.status as number
      )

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoData({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(async () => {
      paystack.refuseRefunds(undefined)
      await buyer.load()
    })

    const post = async (path: string, body = {}, shop: Shop = GROCERY) =>
      api.post(`/vendor/orders/${path}`, body, await buyer.owner(shop))
    const admin = () => adminHeaders(getContainer(), api)
    const owedRefunds = async () => (await api.get("/admin/owed-refunds", await admin())).data.owed_refunds as any[]
    const owedRefundOf = async (orderId: string) => (await owedRefunds()).find((o) => o.order_id === orderId)

    /** Ada's paid checkout; the grocery removes one of its two bags of rice, and Paystack refuses the refund. */
    const refusedRefund = async () => {
      const { cartId, reference } = await buyer.paidCheckout()
      const orderId = await buyer.shopOrderId(GROCERY, cartId)
      await post(`${orderId}/accept`)
      await post(`${orderId}/start-picking`)
      const { pick_list } = (await api.get(`/vendor/orders/${orderId}/pick-list`, await buyer.owner(GROCERY))).data
      await post(`${orderId}/pick-list/${pick_list.lines[0].id}/unavailable`, { quantity: 1 })
      paystack.refuseRefunds(BALANCE)
      const { data } = await post(`${orderId}/remove-unavailable`)
      return { cartId, reference, orderId, removed: data }
    }

    describe("a refund Paystack refuses", () => {
      it("is recorded as owed, with its amount, Paystack's reason and the attempt, and the order edit stands", async () => {
        const { orderId, reference, removed } = await refusedRefund()

        expect(removed).toMatchObject({ removed_amount: RICE.price, refund: null })
        expect(paystack.refundsOf(reference)).toEqual([])
        expect(await owedRefundOf(orderId)).toMatchObject({
          order_id: orderId,
          display_id: expect.any(Number),
          buyer: { email: ADA },
          amount: RICE.price,
          currency_code: "ngn",
          attempts: 1,
          last_error: BALANCE,
          state: "retrying",
        })
        const { order } = (await api.get(`/vendor/orders/${orderId}?fields=*items`, await buyer.owner(GROCERY))).data
        expect(order.items.map((i: any) => i.quantity)).toEqual([1])
      })
    })

    it("is for Oja's staff only", async () => {
      expect(await status(api.get("/admin/owed-refunds", await buyer.owner(GROCERY)))).toBe(401)
    })
  },
})
