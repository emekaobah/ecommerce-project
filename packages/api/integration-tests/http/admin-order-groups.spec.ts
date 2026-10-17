import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { adminHeaders } from "../helpers/auth"
import { checkoutFakes, checkoutSuite } from "../helpers/checkout-suite"
import { GADGETS, GROCERY, ORDER_TOTALS, TOTAL } from "../helpers/checkout"

jest.setTimeout(5 * 60 * 1000)

const fakes = checkoutFakes(26000)

/** What the admin panel's order list asks of each order group (Mercur 2.3.5's DEFAULT_FIELDS). */
const GROUP_LIST_FIELDS = [
  "id",
  "display_id",
  "seller_count",
  "total",
  "created_at",
  "orders.id",
  "orders.status",
  "orders.display_id",
  "orders.payment_status",
  "orders.fulfillment_status",
  "orders.total",
  "orders.currency_code",
  "*orders.payment_collections",
  "*orders.seller",
].join(",")

const GADGETS_SHARE = ORDER_TOTALS.get(GADGETS)!
const GROCERY_SHARE = ORDER_TOTALS.get(GROCERY)!

// The admin shows each order of a checkout split across shops its own payment status, and the
// checkout's shared Paystack payment beside them (#14).
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    const buyer = checkoutSuite({ api, getContainer, fakes })
    const admin = () => adminHeaders(getContainer(), api)
    const get = async (path: string) => (await api.get(path, await admin())).data

    /** Ada's checkout across two shops, the gadget hub's order rejected and refunded. */
    const halfRefunded = async () => {
      const { cartId, reference } = await buyer.paidCheckout()
      const gadgets = await buyer.shopOrderId(GADGETS, cartId)
      const grocery = await buyer.shopOrderId(GROCERY, cartId)
      await api.post(`/vendor/orders/${gadgets}/reject`, { reason: "Out of stock" }, await buyer.owner(GADGETS))
      return { groupId: await buyer.orderGroupOf(cartId), reference, gadgets, grocery }
    }
    const statusesOf = (orders: any[], ids: { gadgets: string; grocery: string }) =>
      Object.fromEntries(
        orders
          .filter((o) => o.id === ids.gadgets || o.id === ids.grocery)
          .map((o) => [o.id === ids.gadgets ? "gadgets" : "grocery", [o.payment_status, o.fulfillment_status]])
      )
    const OWN = { gadgets: ["refunded", "not_fulfilled"], grocery: ["captured", "not_fulfilled"] }

    it("lists each order of a group with its own payment status", async () => {
      const ids = await halfRefunded()

      const { order_groups } = await get(`/admin/order-groups?fields=${GROUP_LIST_FIELDS}&limit=50`)
      const group = order_groups.find((g: any) => g.id === ids.groupId)

      expect(statusesOf(group.orders, ids)).toEqual(OWN)
    })

    it("shows each order its own payment status in a group's detail and the order page's group", async () => {
      const ids = await halfRefunded()

      const { order_group } = await get(`/admin/order-groups/${ids.groupId}?fields=${GROUP_LIST_FIELDS}`)
      expect(statusesOf(order_group.orders, ids)).toEqual(OWN)
      const fromOrder = await get(`/admin/orders/${ids.grocery}/order-group?fields=${GROUP_LIST_FIELDS}`)
      expect(statusesOf(fromOrder.order_group.orders, ids)).toEqual(OWN)
    })

    it("shows the order page and the order list each order's own payment status, and still the checkout's payment", async () => {
      const ids = await halfRefunded()

      const gadgets = (await get(`/admin/orders/${ids.gadgets}`)).order
      const grocery = (await get(`/admin/orders/${ids.grocery}`)).order
      expect([gadgets.payment_status, grocery.payment_status]).toEqual(["refunded", "captured"])
      // The payment collection is the checkout's one Paystack payment, as Paystack has it.
      expect(grocery.payment_collections[0]).toMatchObject({ captured_amount: TOTAL, refunded_amount: GADGETS_SHARE })
      const { orders } = await get(`/admin/orders?fields=id,payment_status,fulfillment_status&limit=50`)
      expect(statusesOf(orders, ids)).toEqual(OWN)
    })

    it("shows the order page's Checkout: every order of the group with its own status, and the shared payment", async () => {
      const ids = await halfRefunded()

      const { checkout } = await get(`/admin/orders/${ids.grocery}/checkout`)

      expect(checkout).toMatchObject({
        id: ids.groupId,
        display_id: expect.any(Number),
        currency_code: "ngn",
        payment: {
          status: "partially_refunded",
          amount: TOTAL,
          captured_amount: TOTAL,
          refunded_amount: GADGETS_SHARE,
          reference: ids.reference,
        },
      })
      expect(checkout.orders).toHaveLength(2)
      expect(checkout.orders).toEqual(
        expect.arrayContaining([
          {
            id: ids.gadgets,
            display_id: expect.any(Number),
            shop: GADGETS.name,
            total: expect.any(Number),
            payment_status: "refunded",
            fulfillment_status: "not_fulfilled",
            captured_amount: GADGETS_SHARE,
            refunded_amount: GADGETS_SHARE,
          },
          {
            id: ids.grocery,
            display_id: expect.any(Number),
            shop: GROCERY.name,
            total: GROCERY_SHARE,
            payment_status: "captured",
            fulfillment_status: "not_fulfilled",
            captured_amount: GROCERY_SHARE,
            refunded_amount: 0,
          },
        ])
      )
    })
  },
})
