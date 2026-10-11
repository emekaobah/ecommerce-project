import { canReview } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { fulfilmentsOf } from "./order-fulfilment"

// Reviews and ratings (#7) on Mercur's review module: one `review` per target (a shop, or a
// catalogue product), linked to the order that earned it and the buyer who wrote it, and
// moderated by an operator (pending → published or rejected) before other buyers see it.

type Scope = Pick<MedusaContainer, "resolve">

export type ReviewTarget = { reference: "product" | "seller"; reference_id: string }

type ReviewableOrderRow = {
  id: string
  seller?: { id: string } | null
  items?: ({ product_id: string | null; quantity: unknown; detail?: { quantity: unknown } | null } | null)[] | null
}

/**
 * Refuses a review the buyer may not write: of another buyer's order (not found), of a shop's
 * order before it reached its terminal success state (`canReview`), or of a target the order
 * didn't bring them: a shop other than the order's, or a product they didn't receive on it.
 * Mercur's create workflow then checks the target isn't already reviewed on the order.
 */
export async function assertReviewable(
  scope: Scope,
  { customer_id, order_id, reference, reference_id }: ReviewTarget & { customer_id: string; order_id: string }
): Promise<void> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "seller.id", "items.product_id", "items.quantity", "items.detail.quantity"],
    filters: { id: order_id, customer_id },
  })
  const [order] = data as unknown as ReviewableOrderRow[]
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order with id ${order_id} was not found`)

  const fulfilment = (await fulfilmentsOf(scope, [order_id])).get(order_id)
  if (!fulfilment || !canReview(fulfilment.state)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "You can review an order once you have received it")
  }

  const received = (order.items ?? []).some(
    (item) => item?.product_id === reference_id && Number(item.detail?.quantity ?? item.quantity) > 0
  )
  const ofOrder = reference === "seller" ? order.seller?.id === reference_id : received
  if (!ofOrder) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `This order has no ${reference} ${reference_id} to review`)
  }
}
