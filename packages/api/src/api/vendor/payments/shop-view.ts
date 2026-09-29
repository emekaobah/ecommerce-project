import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { shopPaymentView, type Payment } from "../../../lib/shop-order"
import { shareFor, sharesOf, viewResponses } from "../shop-share"

type VendorRequest = MedusaRequest & { seller_context?: { seller_id: string } }

/** The shop's order paid by each payment: a checkout's payment sits on its cart, split into an order per shop. */
async function shopOrderOfPayments(req: VendorRequest, paymentIds: string[]) {
  const sellerId = req.seller_context?.seller_id
  if (!sellerId) throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No shop to show the payment to")
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: payments } = await query.graph({
    entity: "payment",
    fields: ["id", "payment_collection.cart.id"],
    filters: { id: paymentIds },
  })
  const cartOf = new Map(
    (payments as { id: string; payment_collection?: { cart?: { id: string } | null } | null }[]).map((p) => [
      p.id,
      p.payment_collection?.cart?.id,
    ])
  )
  const { data: carts } = await query.graph({
    entity: "order_cart",
    fields: ["cart_id", "order_id"],
    filters: { cart_id: [...cartOf.values()].filter((id): id is string => !!id) },
  })
  const { data: owned } = await query.graph({
    entity: "order_seller",
    fields: ["order_id"],
    filters: { seller_id: sellerId, order_id: carts.map((c: { order_id: string }) => c.order_id) },
  })
  const ownedIds = new Set(owned.map((o: { order_id: string }) => o.order_id))
  const orderOfCart = new Map(
    (carts as { cart_id: string; order_id: string }[]).filter((c) => ownedIds.has(c.order_id)).map((c) => [c.cart_id, c.order_id])
  )
  return new Map(paymentIds.map((id) => [id, orderOfCart.get(cartOf.get(id) ?? "") ?? id]))
}

/** Every vendor payment response shows the shop its own order's share of the payment. */
export const showTheShopItsOwnPayment = viewResponses(async (req, body) => {
  const { payment, payments } = body as { payment?: Payment; payments?: Payment[] }
  const all = [...(payment ? [payment] : []), ...(payments ?? [])]
  if (!all.length) return body
  const orderOf = await shopOrderOfPayments(req, all.map((p) => p.id))
  const shares = await sharesOf(req.scope, [...orderOf.values()])
  const view = (p: Payment) => shopPaymentView(p, shareFor(shares, orderOf.get(p.id)!))
  return { ...body, ...(payment && { payment: view(payment) }), ...(payments && { payments: payments.map(view) }) }
})
