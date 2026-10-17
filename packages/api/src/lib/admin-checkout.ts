import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getOrderGroupDetailWorkflow } from "@mercurjs/core/workflows"
import {
  ownPaymentStatus,
  paymentShare,
  paymentStatusOf,
  transactionsOf,
  type OrderShare,
  type OrderTransaction,
  type PaymentCollection,
} from "./shop-order"

// Oja's operators see a checkout split across shops two ways (#14): each order with its own
// payment status, from its own share of the checkout's payment as the shop sees it
// (lib/shop-order), and the checkout's one Paystack payment, for reconciling with Paystack.
// Mercur works each order's status out from the whole shared payment, so one order refunded
// in full makes every order of the checkout read "partially refunded".

type OrderRow = {
  id: string
  currency_code: string
  total: number
  transactions?: OrderTransaction[] | null
  cart?: { payment_collection?: PaymentCollection | null } | null
}

/**
 * Each order, its checkout's payment collection, which Mercur keeps on the cart it split, and
 * its own payment status from its share of it (none when the payment can't be found).
 */
async function ordersWithCheckoutPayment(scope: MedusaContainer, orderIds: string[]) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "currency_code",
      "total",
      "transactions.amount",
      "transactions.reference",
      "transactions.reference_id",
      ...["status", "amount", "authorized_amount", "captured_amount", "refunded_amount", "payments.data"].map(
        (field) => `cart.payment_collection.${field}`
      ),
    ],
    filters: { id: orderIds },
  })
  return (data as unknown as OrderRow[]).map((order) => {
    const found = order.cart?.payment_collection
    const share: OrderShare = { total: Number(order.total), transactions: transactionsOf(order) }
    const collection = found
      ? {
          ...found,
          amount: Number(found.amount ?? 0),
          authorized_amount: Number(found.authorized_amount ?? 0),
          captured_amount: Number(found.captured_amount ?? 0),
          refunded_amount: Number(found.refunded_amount ?? 0),
        }
      : null
    return {
      id: order.id,
      currency_code: order.currency_code,
      share,
      collection,
      payment_status: collection ? ownPaymentStatus(order, [collection], share) : null,
    }
  })
}

/** Each order's own payment status; an order its checkout's payment can't be found for has none. */
export async function ownPaymentStatuses(scope: MedusaContainer, orderIds: string[]): Promise<Map<string, string>> {
  if (!orderIds.length) return new Map()
  const orders = await ordersWithCheckoutPayment(scope, orderIds)
  return new Map(orders.flatMap((o) => (o.payment_status ? [[o.id, o.payment_status] as const] : [])))
}

export type CheckoutOrder = {
  id: string
  display_id: number
  shop: string | null
  total: number
  payment_status: string
  fulfillment_status: string
  /** What was captured for the order, and refunded of it, from its own transactions. */
  captured_amount: number
  refunded_amount: number
}
export type CheckoutPayment = {
  /** The whole payment's status, as Paystack has it: one transaction for the checkout. */
  status: string
  amount: number
  captured_amount: number
  refunded_amount: number
  /** Paystack's transaction reference. */
  reference: string | null
}
export type AdminCheckout = {
  id: string
  display_id: number
  currency_code: string
  orders: CheckoutOrder[]
  payment: CheckoutPayment | null
}

type GroupOrder = {
  id: string
  display_id: number
  total: number
  seller?: { name?: string | null } | null
  fulfillment_status: string
  payment_status: string
}

/** The checkout an order was placed in: each of its orders with their own statuses, and its one payment. */
export async function checkoutOfOrder(scope: MedusaContainer, orderId: string): Promise<AdminCheckout> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({
    entity: "order_group_order",
    fields: ["order_group_id"],
    filters: { order_id: orderId },
  })
  const groupId = (links[0] as unknown as { order_group_id?: string } | undefined)?.order_group_id
  if (!groupId) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} has no checkout`)
  // Mercur's own read of the group, for each order's fulfilment status.
  const { result } = await getOrderGroupDetailWorkflow(scope).run({
    input: {
      order_group_id: groupId,
      fields: ["id", "display_id", "orders.id", "orders.display_id", "orders.total", "orders.seller.name"],
    },
  })
  const group = result as unknown as { id: string; display_id: number; orders?: GroupOrder[] }
  const groupOrders = group.orders ?? []
  const money = new Map((await ordersWithCheckoutPayment(scope, groupOrders.map((o) => o.id))).map((o) => [o.id, o]))
  const own = money.get(orderId)
  const currency = own?.currency_code ?? ""
  const collection = own?.collection ?? null
  const reference = (collection?.payments ?? [])
    .map((p) => (p.data as { reference?: unknown } | null | undefined)?.reference)
    .find((r): r is string => typeof r === "string")

  return {
    id: group.id,
    display_id: group.display_id,
    currency_code: currency,
    orders: groupOrders.map((order) => {
      const row = money.get(order.id)
      const share = row?.collection ? paymentShare(row.collection, row.share) : null
      return {
        id: order.id,
        display_id: order.display_id,
        shop: order.seller?.name ?? null,
        total: Number(order.total),
        payment_status: row?.payment_status ?? order.payment_status,
        fulfillment_status: order.fulfillment_status,
        captured_amount: share?.captured_amount ?? 0,
        refunded_amount: share?.refunded_amount ?? 0,
      }
    }),
    payment: collection
      ? {
          status: paymentStatusOf({ currency_code: currency, payment_collections: [collection] }),
          amount: collection.amount,
          captured_amount: collection.captured_amount,
          refunded_amount: collection.refunded_amount,
          reference: reference ?? null,
        }
      : null,
  }
}
