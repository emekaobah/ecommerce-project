import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { MercurModules } from "@mercurjs/types"
import { seedDemoWorld } from "../../src/scripts/seed"
import { SEED_PRODUCTS } from "../../src/scripts/seed-data"
import { buyerCheckout, GROCERY, RICE, type Shop } from "../helpers/checkout"
import { fakeClerk } from "../helpers/clerk"
import { fakePaystack } from "../helpers/paystack"
import { fakeShipbubble } from "../helpers/shipbubble"

jest.setTimeout(5 * 60 * 1000)

const PALM_OIL = SEED_PRODUCTS.find((p) => p.title === "Red Palm Oil 3L")!

const clerk = fakeClerk()
// A port per test process, so each fake can be named in the config before it is listening.
const paystack = fakePaystack(25000 + (process.pid % 1000))
const shipbubble = fakeShipbubble(26000 + (process.pid % 1000))
// Set before the runner loads medusa-config, which registers each provider only when its key is set.
process.env.CLERK_JWT_KEY = clerk.jwtKey
process.env.PAYSTACK_SECRET_KEY = paystack.secretKey
process.env.PAYSTACK_API_URL = paystack.apiUrl
process.env.SHIPBUBBLE_API_KEY = shipbubble.apiKey
process.env.SHIPBUBBLE_API_URL = shipbubble.apiUrl

// Order again (#72): a buyer reorders one shop's part of a delivered order, seeing each item at
// today's price and whether it is still there, then adds the ticked items to the cart at once.
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = buyerCheckout({ api, getContainer, clerk, paystack })
    const ben = buyerCheckout({ api, getContainer, clerk, paystack, email: "ben@oja.test" })

    beforeAll(async () => {
      await Promise.all([paystack.start(), shipbubble.start()])
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })
    afterAll(() => Promise.all([paystack.stop(), shipbubble.stop()]))
    beforeEach(async () => {
      shipbubble.reset()
      await Promise.all([buyer.load(), ben.load()])
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

    /** Ada's paid checkout of two bags of rice and a palm oil from the grocery: its order group and the grocery's order. */
    const paidGroceries = async () => {
      const { data } = await api.post("/store/carts", { region_id: buyer.regionId() }, buyer.ada())
      const cartId = data.cart.id as string
      await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await buyer.offerId(GROCERY, RICE.title), quantity: 2 }, buyer.ada())
      await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await buyer.offerId(GROCERY, PALM_OIL.title), quantity: 1 }, buyer.ada())
      await buyer.prepare(cartId)
      const { reference } = await buyer.startPayment(cartId)
      paystack.pay(reference)
      await buyer.postWebhook(paystack.chargeSuccess(reference))
      const groupId = await buyer.orderGroupOf(cartId)
      await buyer.capturedWithin(cartId)
      return { groupId, orderId: await buyer.shopOrderId(GROCERY, cartId) }
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
    const deliveredGroceries = async () => {
      const order = await paidGroceries()
      await deliver(order.orderId)
      return order
    }

    const preview = async (groupId: string, as = buyer.ada()) =>
      (await api.get(`/store/order-history/${groupId}/order-again?seller_id=${await buyer.sellerId(GROCERY)}`, as)).data.order_again
    const lineOf = (orderAgain: any, title: string) => orderAgain.items.find((i: any) => i.product_title === title)

    /** Sets how many of the offer are stocked at its one location; returns what it was. */
    const stock = async (offerId: string, units: number) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "offer",
        fields: ["inventory_item_link.inventory_item.location_levels.*"],
        filters: { id: offerId },
      })
      const [level] = (data[0] as any).inventory_item_link[0].inventory_item.location_levels
      await getContainer()
        .resolve(Modules.INVENTORY)
        .updateInventoryLevels([{ inventory_item_id: level.inventory_item_id, location_id: level.location_id, stocked_quantity: units }])
      return Number(level.stocked_quantity)
    }
    /** Sets the grocery's price of its offer; returns what it was. */
    const price = async (offerId: string, amount: number) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity: "offer", fields: ["prices.id", "prices.amount", "prices.currency_code"], filters: { id: offerId } })
      const ngn = (data[0] as any).prices.find((p: any) => p?.currency_code === "ngn")
      await vendor(GROCERY, `offers/${offerId}`, { prices: [{ id: ngn.id, amount, currency_code: "ngn" }] })
      return Number(ngn.amount)
    }

    describe("GET /store/order-history/:id/order-again", () => {
      it("shows each item of the shop's delivered order at today's price against what was paid, and whether it is still there", async () => {
        const { groupId } = await deliveredGroceries()
        const rice = await buyer.offerId(GROCERY, RICE.title)
        const palmOil = await buyer.offerId(GROCERY, PALM_OIL.title)
        const stocked = await stock(rice, 0)
        const was = await price(palmOil, PALM_OIL.price + 1000)
        try {
          const orderAgain = await preview(groupId)

          expect(orderAgain.seller).toMatchObject({ id: await buyer.sellerId(GROCERY), name: GROCERY.name })
          expect(orderAgain.shop_status.orderable).toBe(true)
          expect(orderAgain.not_taking_orders).toBeNull()
          expect(lineOf(orderAgain, RICE.title)).toMatchObject({
            quantity: 2,
            paid_unit_price: RICE.price,
            offer: { id: rice, unit_price: RICE.price, available_quantity: 0 },
            price_changed: false,
            unavailable: "sold_out",
          })
          expect(lineOf(orderAgain, PALM_OIL.title)).toMatchObject({
            quantity: 1,
            paid_unit_price: PALM_OIL.price,
            offer: { id: palmOil, unit_price: PALM_OIL.price + 1000 },
            price_changed: true,
            unavailable: null,
          })
          expect(lineOf(orderAgain, PALM_OIL.title).variant_id).toEqual(expect.any(String))
        } finally {
          await stock(rice, stocked)
          await price(palmOil, was)
        }
      })

      it("says a paused shop isn't taking orders, with its note", async () => {
        const { groupId } = await deliveredGroceries()
        await vendor(GROCERY, "shop-hours/pause", { note: "Restocking" })
        try {
          const orderAgain = await preview(groupId)

          expect(orderAgain.not_taking_orders).toBe("paused")
          expect(orderAgain.shop_status).toMatchObject({ state: "closed_until", reason: "pause", note: "Restocking", orderable: false })
        } finally {
          await vendor(GROCERY, "shop-hours/resume")
        }
      })

      it("says a shop that is no longer selling on Oja has left, with none of its items to add", async () => {
        const { groupId } = await deliveredGroceries()
        const sellers = getContainer().resolve(MercurModules.SELLER) as any
        const sellerId = await buyer.sellerId(GROCERY)
        await sellers.updateSellers({ id: sellerId, status: "suspended" })
        try {
          const orderAgain = await preview(groupId)

          expect(orderAgain.not_taking_orders).toBe("left")
          expect(orderAgain.shop_status).toBeNull()
          expect(orderAgain.items.map((i: any) => [i.product_title, i.offer, i.unavailable]).sort()).toEqual([
            [RICE.title, null, "not_sold"],
            [PALM_OIL.title, null, "not_sold"],
          ].sort())
        } finally {
          await sellers.updateSellers({ id: sellerId, status: "open" })
        }
      })

      it("refuses an order that hasn't been delivered or collected", async () => {
        const { groupId } = await paidGroceries()

        expect(await status(preview(groupId))).toBe(400)
      })

      it("is not found for another buyer's order, or a shop not in the order", async () => {
        const { groupId } = await deliveredGroceries()
        const { data } = await api.get(`/store/order-history/${groupId}/order-again?seller_id=sel_missing`, buyer.ada()).catch((e) => ({ data: e.response }))

        expect(data.status).toBe(404)
        expect(await status(preview(groupId, ben.ada()))).toBe(404)
      })
    })

    describe("POST /store/carts/:id/offer-lines", () => {
      it("adds several offers to the cart in one call, each at its shop's price", async () => {
        const { groupId } = await deliveredGroceries()
        const orderAgain = await preview(groupId)
        const { data: created } = await api.post("/store/carts", { region_id: buyer.regionId() }, buyer.ada())

        const { data } = await api.post(
          `/store/carts/${created.cart.id}/offer-lines`,
          { items: orderAgain.items.map((i: any) => ({ offer_id: i.offer.id, quantity: i.quantity })) },
          buyer.ada()
        )

        expect(data.cart.items.map((i: any) => [i.product_title, i.quantity, Number(i.unit_price)]).sort()).toEqual(
          [
            [RICE.title, 2, RICE.price],
            [PALM_OIL.title, 1, PALM_OIL.price],
          ].sort()
        )
      })

      it("adds none of them when the shop isn't taking orders", async () => {
        const { data: created } = await api.post("/store/carts", { region_id: buyer.regionId() }, buyer.ada())
        const items = [
          { offer_id: await buyer.offerId(GROCERY, RICE.title), quantity: 1 },
          { offer_id: await buyer.offerId(GROCERY, PALM_OIL.title), quantity: 1 },
        ]
        await vendor(GROCERY, "shop-hours/pause", {})
        try {
          expect(await status(api.post(`/store/carts/${created.cart.id}/offer-lines`, { items }, buyer.ada()))).toBe(400)
          const { data } = await api.get(`/store/carts/${created.cart.id}`, buyer.ada())
          expect(data.cart.items).toEqual([])
        } finally {
          await vendor(GROCERY, "shop-hours/resume")
        }
      })

      it("refuses an empty list", async () => {
        const { data: created } = await api.post("/store/carts", { region_id: buyer.regionId() }, buyer.ada())

        expect(await status(api.post(`/store/carts/${created.cart.id}/offer-lines`, { items: [] }, buyer.ada()))).toBe(400)
      })
    })
  },
})
