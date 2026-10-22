import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import seedDemoData from "../../src/scripts/seed"
import { SEED_PRODUCTS } from "../../src/scripts/seed-data"
import { buyerCheckout, GADGETS, GROCERY, ORDER_TOTALS, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { BEST_VALUE_FEE, fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so the fake can be named in the config before it is listening.
const paystack = fakePaystack(58000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(59000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

const BEANS = SEED_PRODUCTS.find((p) => p.title === "Honey Beans (Oloyin) 2kg")!

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
    beforeEach(() => buyer.load())

    const post = async (path: string, body = {}, shop: Shop = GROCERY) =>
      api.post(`/vendor/orders/${path}`, body, await buyer.owner(shop))
    const get = async (path: string, shop: Shop = GROCERY) => (await api.get(`/vendor/orders/${path}`, await buyer.owner(shop))).data
    const pickList = async (orderId: string, shop: Shop = GROCERY) => (await get(`${orderId}/pick-list`, shop)).pick_list
    const pick = (orderId: string, itemId: string, picked: number) => post(`${orderId}/pick-list/${itemId}`, { picked })
    const markUnavailable = (orderId: string, itemId: string, quantity: number, shop: Shop = GROCERY) =>
      post(`${orderId}/pick-list/${itemId}/unavailable`, { quantity }, shop)
    const removeUnavailable = (orderId: string, shop: Shop = GROCERY) => post(`${orderId}/remove-unavailable`, {}, shop)
    const pack = (orderId: string) => post(`${orderId}/pack`)
    const state = async (orderId: string) => (await get(orderId)).order.fulfilment.state
    const lineOf = (list: any, title: string) => list.lines.find((l: any) => l.product_title === title)

    /** Ada's paid checkout of the usual cart, and the grocery's order of it: two bags of rice on one line. */
    const paidRice = async () => {
      const { cartId, reference } = await buyer.paidCheckout()
      return { cartId, reference, orderId: await buyer.shopOrderId(GROCERY, cartId) }
    }

    /** Ada pays for two bags of rice and a bag of beans from the grocery alone: an order of two lines. */
    const paidRiceAndBeans = async () => {
      const { data } = await api.post("/store/carts", { region_id: buyer.regionId() }, buyer.ada())
      const cartId = data.cart.id as string
      for (const [title, quantity] of [[RICE.title, 2], [BEANS.title, 1]] as const) {
        await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await buyer.offerId(GROCERY, title), quantity }, buyer.ada())
      }
      await buyer.prepare(cartId)
      const { reference } = await buyer.startPayment(cartId)
      paystack.pay(reference)
      await buyer.postWebhook(paystack.chargeSuccess(reference))
      await buyer.orderGroupOf(cartId)
      await buyer.capturedWithin(cartId)
      return { cartId, reference: reference as string, orderId: await buyer.shopOrderId(GROCERY, cartId) }
    }

    /** The order accepted and being picked. */
    const startPicking = async (orderId: string) => {
      await post(`${orderId}/accept`)
      return pickList(orderId)
    }

    describe("marking items unavailable", () => {
      it("moves a picking order to partially available, with the marked units and what they cost on the checklist", async () => {
        const { orderId } = await paidRice()
        const [rice] = (await startPicking(orderId)).lines

        const { data } = await markUnavailable(orderId, rice.id, 1)

        expect(data.pick_list.lines[0]).toMatchObject({ quantity: 2, picked: 0, unavailable: 1 })
        expect(data.pick_list.progress).toMatchObject({ picked: 0, total: 2, unavailable: 1, done: false })
        expect(data.pick_list.unavailable_amount).toBe(RICE.price)
        expect(await state(orderId)).toBe("partially_available")
        expect((await pickList(orderId)).lines[0].unavailable).toBe(1)
      })

      it("goes back to picking when the marks are cleared, with nothing to refund", async () => {
        const { orderId, reference } = await paidRice()
        const [rice] = (await startPicking(orderId)).lines
        await markUnavailable(orderId, rice.id, 1)

        const { data } = await markUnavailable(orderId, rice.id, 0)

        expect(data.pick_list.unavailable_amount).toBe(0)
        expect(await state(orderId)).toBe("picking")
        expect(paystack.refundsOf(reference)).toEqual([])
      })

      it("keeps picking the other units while some are marked", async () => {
        const { orderId } = await paidRice()
        const [rice] = (await startPicking(orderId)).lines
        await markUnavailable(orderId, rice.id, 1)

        const { data } = await pick(orderId, rice.id, 1)

        expect(data.pick_list.lines[0]).toMatchObject({ picked: 1, unavailable: 1 })
      })

      it("refuses more units than are left unpicked, and an order not being picked", async () => {
        const { orderId } = await paidRice()
        const [rice] = (await pickList(orderId)).lines

        expect(await status(markUnavailable(orderId, rice.id, 1))).toBe(400)

        await post(`${orderId}/accept`)
        await pick(orderId, rice.id, 1)
        expect(await status(markUnavailable(orderId, rice.id, 2))).toBe(400)
        expect(await status(markUnavailable(orderId, rice.id, -1))).toBe(400)
        expect(await status(markUnavailable(orderId, "ordli_not_on_the_order", 1))).toBe(404)
        expect(await state(orderId)).toBe("picking")
      })

      it("refuses to pack while marked units are still on the order", async () => {
        const { orderId } = await paidRice()
        const [rice] = (await startPicking(orderId)).lines
        await pick(orderId, rice.id, 1)
        await markUnavailable(orderId, rice.id, 1)

        expect(await status(pack(orderId))).toBe(400)
        expect(await state(orderId)).toBe("partially_available")
      })
    })

    describe("removing them from the order", () => {
      it("edits the order and refunds exactly the removed items' amount, then goes back to picking and packs", async () => {
        const { orderId, reference } = await paidRice()
        const [rice] = (await startPicking(orderId)).lines
        await markUnavailable(orderId, rice.id, 1)

        const { data } = await removeUnavailable(orderId)

        expect(data.removed_amount).toBe(RICE.price)
        expect(data.refund).toEqual({ amount: RICE.price, status: "pending" })
        // One refund on the shared Paystack transaction, of the one bag (kobo).
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([RICE.price * 100])
        expect(data.fulfilment.state).toBe("picking")
        expect(data.pick_list.lines[0]).toMatchObject({ quantity: 1, picked: 0, unavailable: 0 })
        expect(data.pick_list.unavailable_amount).toBe(0)
        const order = (await get(`${orderId}?fields=+total,*items`)).order
        expect(order.items.map((i: any) => i.quantity)).toEqual([1])
        expect(order.total).toBe(RICE.price + BEST_VALUE_FEE)

        await pick(orderId, rice.id, 1)
        const packed = await pack(orderId)
        expect(packed.data.fulfilment.state).toBe("packed")
      })

      it("removes a line marked unavailable in full, and refunds just that line", async () => {
        const { orderId, reference } = await paidRiceAndBeans()
        const list = await startPicking(orderId)
        await markUnavailable(orderId, lineOf(list, BEANS.title).id, 1)

        const { data } = await removeUnavailable(orderId)

        expect(data.removed_amount).toBe(BEANS.price)
        expect(paystack.refundsOf(reference).map((r) => r.amount)).toEqual([BEANS.price * 100])
        expect(data.pick_list.lines.map((l: any) => [l.product_title, l.quantity])).toEqual([[RICE.title, 2]])
      })

      it("never pays the shop for removed items whose refund Paystack turned down: the buyer is still owed them", async () => {
        const { orderId, reference } = await paidRice()
        const [rice] = (await startPicking(orderId)).lines
        await markUnavailable(orderId, rice.id, 1)
        paystack.refuseRefunds("Insufficient balance")
        try {
          const { data } = await removeUnavailable(orderId)
          expect(data).toMatchObject({ removed_amount: RICE.price, refund: null })
        } finally {
          paystack.refuseRefunds(undefined)
        }
        expect(paystack.refundsOf(reference)).toEqual([])

        // What the shop will be paid counts the bag as given back, as it would once refunded.
        expect((await get(`${orderId}/payout`)).payout).toMatchObject({
          refunded: RICE.price,
          delivery: BEST_VALUE_FEE,
          commission: RICE.price / 10,
          amount: RICE.price - RICE.price / 10,
        })
      })

      it("refuses to remove every item, and an order with nothing marked", async () => {
        const { orderId, reference } = await paidRice()
        const [rice] = (await startPicking(orderId)).lines

        expect(await status(removeUnavailable(orderId))).toBe(400)

        await markUnavailable(orderId, rice.id, 2)
        expect(await status(removeUnavailable(orderId))).toBe(400)
        expect(await state(orderId)).toBe("partially_available")
        expect((await pickList(orderId)).lines[0]).toMatchObject({ quantity: 2, unavailable: 2 })
        expect(paystack.refundsOf(reference)).toEqual([])
      })

      it("shows the buyer the removed items and their refund, and what was paid", async () => {
        const { cartId, orderId } = await paidRice()
        const [rice] = (await startPicking(orderId)).lines
        await markUnavailable(orderId, rice.id, 1)
        await removeUnavailable(orderId)

        const groupId = await buyer.orderGroupOf(cartId)
        const { order_group } = (await api.get(`/store/order-history/${groupId}`, buyer.ada())).data
        const order = order_group.orders.find((o: any) => o.id === orderId)

        expect(order.items.map((i: any) => [i.product_title, i.quantity, i.unavailable_quantity, i.total])).toEqual([
          [RICE.title, 1, 1, RICE.price],
        ])
        expect(order.refund).toEqual({ amount: RICE.price, status: "pending" })
        expect(order.refunds).toEqual([{ amount: RICE.price, status: "pending", lines: [{ item_id: rice.id, quantity: 1 }] }])
        expect(order.paid_total).toBe(ORDER_TOTALS.get(GROCERY))
        expect(order.fulfilment.state).toBe("picking")
      })
    })

    it("is for the order's own shop only", async () => {
      const { cartId, orderId } = await paidRice()
      const [rice] = (await startPicking(orderId)).lines
      const gadgets = await buyer.shopOrderId(GADGETS, cartId)

      expect(await status(markUnavailable(orderId, rice.id, 1, GADGETS))).toBe(404)
      expect(await status(removeUnavailable(orderId, GADGETS))).toBe(404)
      expect(await status(removeUnavailable(gadgets))).toBe(404)
      expect(await state(orderId)).toBe("picking")
    })
  },
})
