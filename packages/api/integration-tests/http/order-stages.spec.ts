import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"
import type { Fulfilment, FulfilmentState } from "@oja/domain"
import { seedDemoWorld } from "../../src/scripts/seed"
import { SEED_PASSWORD, SEED_SELLERS } from "../../src/scripts/seed-data"
import { fulfilmentService } from "../../src/lib/order-fulfilment"
import { recordPlacedOrderWorkflow } from "../../src/workflows/order-fulfilment/workflows/record-placed-order"
import { vendorHeaders } from "../helpers/auth"

jest.setTimeout(5 * 60 * 1000)

const AT = "2026-10-20T10:00:00.000Z"
const handover = { staff: { actor: "mem_1", at: AT }, pickup: { at: AT } }

/** Each state an order can be in, as its fulfilment records it, and by which method. */
const FULFILMENTS: Record<FulfilmentState, Fulfilment> = {
  new: { method: "delivery", state: "new" },
  accepted: { method: "delivery", state: "accepted" },
  picking: { method: "delivery", state: "picking" },
  partially_available: { method: "pickup", state: "partially_available" },
  packed: { method: "delivery", state: "packed" },
  label_booked: { method: "delivery", state: "label_booked" },
  ready_for_pickup: { method: "pickup", state: "ready_for_pickup" },
  courier_confirmed: { method: "delivery", state: "courier_confirmed", handover: { staff: handover.staff } },
  handed_to_courier: { method: "delivery", state: "handed_to_courier", handover },
  in_transit: { method: "delivery", state: "in_transit", handover },
  delivered: { method: "delivery", state: "delivered", handover },
  collected: { method: "pickup", state: "collected", collection: { actor: "mem_1", at: AT, collectedBy: "Ada" } },
  not_collected: { method: "pickup", state: "not_collected" },
  rejected: { method: "delivery", state: "rejected", rejectedBy: "seller" },
  cancelled: {
    method: "delivery",
    state: "cancelled",
    cancellation: { by: "seller", actor: "mem_1", at: AT, reason: "other", note: "Closed" },
  },
}

const STATES = Object.keys(FULFILMENTS) as FulfilmentState[]

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const [grocery, fashion] = SEED_SELLERS

    beforeAll(async () => {
      await seedDemoWorld({ container: getContainer(), args: [] } as any)
    })

    const sellerId = async (shop: (typeof SEED_SELLERS)[number]) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: [seller] } = await query.graph({ entity: "seller", fields: ["id"], filters: { email: shop.owner.email } })
      return seller.id as string
    }
    const owner = async (shop: (typeof SEED_SELLERS)[number]) =>
      vendorHeaders(api, shop.owner.email, SEED_PASSWORD, await sellerId(shop))

    /**
     * An order placed with the shop, as checkout records it, placed `minutesAgo` before now, then
     * moved on to the state.
     */
    const orderIn = async (shop: (typeof SEED_SELLERS)[number], state: FulfilmentState, minutesAgo: number) => {
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: [region] } = await query.graph({ entity: "region", fields: ["id"], filters: { currency_code: "ngn" } })
      const { result: order } = await createOrderWorkflow(container).run({
        input: {
          region_id: region.id,
          email: "buyer@oja.test",
          currency_code: "ngn",
          items: [{ title: `Order ${state}`, quantity: 1, unit_price: 1500 }],
        },
      })
      await container.resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.ORDER]: { order_id: order.id },
        seller: { seller_id: await sellerId(shop) },
      })
      await recordPlacedOrderWorkflow(container).run({ input: { order_id: order.id } })
      // Set on the row: driving orders into all 15 states through checkout, Paystack, Shipbubble
      // and the staff routes would take minutes per test, and some states no route reaches now.
      const service = fulfilmentService(container)
      const [row] = await service.listOrderFulfilments({ order_id: order.id })
      await service.updateOrderFulfilments({
        id: row.id,
        state,
        fulfilment: FULFILMENTS[state],
        placed_at: new Date(Date.now() - minutesAgo * 60_000),
      })
      return order.id as string
    }

    /** One grocery order in every state, oldest first; and a few of the fashion shop's. */
    const ordersInEveryState = async () => {
      const groceryOrders = new Map<FulfilmentState, string>()
      for (const [i, state] of STATES.entries()) groceryOrders.set(state, await orderIn(grocery, state, 100 - i))
      const fashionOrders = [await orderIn(fashion, "new", 5), await orderIn(fashion, "picking", 4), await orderIn(fashion, "in_transit", 3)]
      return { groceryOrders, fashionOrders }
    }

    it("counts the shop's orders in each stage, not another shop's or finished ones", async () => {
      await ordersInEveryState()

      const { data } = await api.get("/vendor/order-stages", await owner(grocery))
      expect(data.counts).toEqual({ new: 1, picking: 3, ready: 3, out: 3 })

      const other = await api.get("/vendor/order-stages", await owner(fashion))
      expect(other.data.counts).toEqual({ new: 1, picking: 1, ready: 0, out: 1 })
    })

    it("lists the shop's orders in a stage, newest first, with where each is", async () => {
      const { groceryOrders } = await ordersInEveryState()

      const { data } = await api.get("/vendor/order-stages/picking", await owner(grocery))

      expect(data.count).toBe(3)
      expect(data.orders.map((o: any) => [o.id, o.fulfilment.state])).toEqual([
        [groceryOrders.get("partially_available"), "partially_available"],
        [groceryOrders.get("picking"), "picking"],
        [groceryOrders.get("accepted"), "accepted"],
      ])

      const out = await api.get("/vendor/order-stages/out", await owner(fashion))
      expect(out.data.orders.map((o: any) => o.fulfilment.state)).toEqual(["in_transit"])
    })

    it("pages a stage's orders", async () => {
      const { groceryOrders } = await ordersInEveryState()
      const headers = await owner(grocery)

      const first = await api.get("/vendor/order-stages/ready?limit=2", headers)
      const second = await api.get("/vendor/order-stages/ready?limit=2&offset=2", headers)

      expect([first.data.count, first.data.limit, first.data.offset]).toEqual([3, 2, 0])
      expect([...first.data.orders, ...second.data.orders].map((o: any) => o.id)).toEqual([
        groceryOrders.get("ready_for_pickup"),
        groceryOrders.get("label_booked"),
        groceryOrders.get("packed"),
      ])
    })

    it("returns only the fields asked for, with the order's fulfilment", async () => {
      await ordersInEveryState()

      const { data } = await api.get("/vendor/order-stages/new?fields=id,display_id,total,items.product_title,items.quantity", await owner(grocery))

      const [order] = data.orders
      expect(order).toEqual(
        expect.objectContaining({ display_id: expect.any(Number), total: 1500, fulfilment: expect.objectContaining({ state: "new" }) })
      )
      expect(order.items).toEqual([expect.objectContaining({ quantity: 1 })])
      // None of Mercur's heavy order defaults.
      for (const heavy of ["shipping_address", "billing_address", "shipping_methods", "payment_collections", "summary", "returns"]) {
        expect(order).not.toHaveProperty(heavy)
      }
      expect(order.items[0]).not.toHaveProperty("offer")
    })

    it("refuses a stage that isn't one", async () => {
      const status = await api.get("/vendor/order-stages/delivered", await owner(grocery)).then(
        () => 200,
        (e: any) => e.response?.status
      )
      expect(status).toBe(400)
    })
  },
})
