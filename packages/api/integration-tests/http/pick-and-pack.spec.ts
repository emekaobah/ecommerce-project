import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import seedDemoData from "../../src/scripts/seed"
import { buyerCheckout, GADGETS, GROCERY, LANTERN, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const clerk = fakeClerk()
// A port per test process, so the fake can be named in the config before it is listening.
const paystack = fakePaystack(51000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(52000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

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

    /** The grocery shop's order of Ada's paid checkout: two bags of rice on one line. */
    const groceryOrder = async () => buyer.shopOrderId(GROCERY, (await buyer.paidCheckout()).cartId)
    const post = async (shop: Shop, path: string, body = {}) => api.post(`/vendor/orders/${path}`, body, await buyer.owner(shop))
    const get = async (shop: Shop, path: string) => (await api.get(`/vendor/orders/${path}`, await buyer.owner(shop))).data
    const accept = (orderId: string) => post(GROCERY, `${orderId}/accept`)
    const startPicking = (orderId: string, shop = GROCERY) => post(shop, `${orderId}/start-picking`)
    const pickList = (orderId: string, shop = GROCERY) => get(shop, `${orderId}/pick-list`)
    const pick = (orderId: string, itemId: string, picked: number, shop = GROCERY) =>
      post(shop, `${orderId}/pick-list/${itemId}`, { picked })
    const pack = (orderId: string, shop = GROCERY) => post(shop, `${orderId}/pack`)
    const state = async (orderId: string) => (await get(GROCERY, orderId)).order.fulfilment.state
    /** An accepted order the shop has started picking, and its one line. */
    const picking = async () => {
      const orderId = await groceryOrder()
      await accept(orderId)
      await startPicking(orderId)
      const { pick_list } = await pickList(orderId)
      return { orderId, itemId: pick_list.lines[0].id as string }
    }

    describe("starting to pick", () => {
      it("moves an accepted order to picking, with a checklist of its lines and nothing picked", async () => {
        const orderId = await groceryOrder()
        await accept(orderId)

        const { data } = await startPicking(orderId)

        expect(data.fulfilment.state).toBe("picking")
        expect(await state(orderId)).toBe("picking")
        const { pick_list } = await pickList(orderId)
        expect(pick_list).toEqual({
          lines: [
            {
              id: expect.any(String),
              product_title: RICE.title,
              variant_title: RICE.title,
              thumbnail: expect.any(String),
              quantity: 2,
              picked: 0,
              codes: [RICE.barcode],
            },
          ],
          progress: { picked: 0, total: 2, unpicked: [pick_list.lines[0].id], done: false },
        })
      })

      it("refuses an order that isn't accepted", async () => {
        const orderId = await groceryOrder()

        expect(await status(startPicking(orderId))).toBe(400)
        expect(await state(orderId)).toBe("new")
      })
    })

    describe("ticking lines off", () => {
      it("keeps each line's picked count, for whoever opens the checklist next", async () => {
        const { orderId, itemId } = await picking()

        const { data } = await pick(orderId, itemId, 1)

        expect(data.pick_list.lines[0].picked).toBe(1)
        expect(data.pick_list.progress).toMatchObject({ picked: 1, total: 2, done: false })
        expect((await pickList(orderId)).pick_list.lines[0].picked).toBe(1)

        await pick(orderId, itemId, 0)
        expect((await pickList(orderId)).pick_list.lines[0].picked).toBe(0)
      })

      it("refuses a count below none or above what was ordered, and a line that isn't the order's", async () => {
        const { orderId, itemId } = await picking()

        expect(await status(pick(orderId, itemId, 3))).toBe(400)
        expect(await status(pick(orderId, itemId, -1))).toBe(400)
        expect(await status(pick(orderId, itemId, 1.5))).toBe(400)
        expect(await status(pick(orderId, "ordli_not_on_the_order", 1))).toBe(404)
        expect((await pickList(orderId)).pick_list.lines[0].picked).toBe(0)
      })

      it("refuses picks while the order isn't being picked", async () => {
        const orderId = await groceryOrder()
        await accept(orderId)
        const itemId = (await pickList(orderId)).pick_list.lines[0].id

        expect(await status(pick(orderId, itemId, 1))).toBe(400)
      })
    })

    describe("packing", () => {
      it("is refused until every line is picked in full", async () => {
        const { orderId, itemId } = await picking()
        await pick(orderId, itemId, 1)

        expect(await status(pack(orderId))).toBe(400)
        expect(await state(orderId)).toBe("picking")
      })

      it("moves a fully picked order to packed, after which picks are refused", async () => {
        const { orderId, itemId } = await picking()
        await pick(orderId, itemId, 2)

        const { data } = await pack(orderId)

        expect(data.fulfilment.state).toBe("packed")
        expect(await state(orderId)).toBe("packed")
        expect(await status(pick(orderId, itemId, 1))).toBe(400)
        expect((await pickList(orderId)).pick_list.progress.done).toBe(true)
      })

      it("refuses an accepted order not yet picked", async () => {
        const orderId = await groceryOrder()
        await accept(orderId)

        expect(await status(pack(orderId))).toBe(400)
        expect(await state(orderId)).toBe("accepted")
      })
    })

    it("is for the order's own shop only", async () => {
      const cartId = (await buyer.paidCheckout()).cartId
      const gadgets = await buyer.shopOrderId(GADGETS, cartId)
      await post(GADGETS, `${gadgets}/accept`)
      const itemId = (await pickList(gadgets, GADGETS)).pick_list.lines[0].id
      expect((await pickList(gadgets, GADGETS)).pick_list.lines[0].codes).toEqual([LANTERN.barcode])

      expect(await status(startPicking(gadgets, GROCERY))).toBe(404)
      expect(await status(pickList(gadgets, GROCERY))).toBe(404)
      expect(await status(pick(gadgets, itemId, 1, GROCERY))).toBe(404)
      expect(await status(pack(gadgets, GROCERY))).toBe(404)
    })
  },
})
