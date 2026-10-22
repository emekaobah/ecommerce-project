import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { deleteLineItemsWorkflow, deletePaymentSessionsWorkflow, updateLineItemInCartWorkflow } from "@medusajs/medusa/core-flows"
import { stockShortfall, type NotPlacedChange, type NotPlacedReason } from "@oja/domain"
import { applyShopPromotionsWorkflow } from "../workflows/checkout/apply-shop-promotions"
import { removeCartDeliveriesWorkflow } from "../workflows/checkout/remove-cart-deliveries"
import { retrieveCartBySeller, type CartItem } from "./cart"

// Fixing a paid cart that failed to become orders, once it is refunded (#38): as checkout does
// when prices change, the buyer then sees what changed and pays the new total.

type Scope = Pick<MedusaContainer, "resolve">

const item = (line: CartItem, seller: string | null) => ({
  product_title: line.product_title,
  variant_title: line.variant_title,
  seller,
})

/**
 * Fixes a cart that was refunded because it failed to become orders, once its payment sessions
 * are deleted (`deleteCartSessions`): lines whose offer is gone are removed, sold-out lines cut
 * to what is left (removed when none is), deliveries whose option is gone taken off, and codes
 * used up dropped. Returns what changed, and the causes.
 */
export async function fixUnplacedCart(
  scope: Scope,
  cartId: string
): Promise<{ changes: NotPlacedChange[]; causes: Set<NotPlacedReason> }> {
  const container = scope as MedusaContainer
  const changes: NotPlacedChange[] = []
  const causes = new Set<NotPlacedReason>()
  const { sellers } = await retrieveCartBySeller(container, cartId)

  const removed: string[] = []
  for (const line of sellers.filter((g) => !g.seller).flatMap((g) => g.items)) {
    removed.push(line.id)
    changes.push({ type: "item_removed", ...item(line, null), quantity: line.quantity })
    causes.add("unavailable")
  }
  const sold = sellers.filter((g) => g.seller).flatMap((g) => g.items.map((line) => ({ line, seller: g.seller!.name })))
  const reduced: { id: string; quantity: number }[] = []
  for (const { line, seller } of sold) {
    const shortfall = stockShortfall(line.quantity, line.available_quantity)
    if (!shortfall) continue
    causes.add("sold_out")
    if (shortfall.type === "sold_out") {
      removed.push(line.id)
      changes.push({ type: "item_removed", ...item(line, seller), quantity: line.quantity })
    } else {
      reduced.push({ id: line.id, quantity: shortfall.left })
      changes.push({ type: "quantity_reduced", ...item(line, seller), was: line.quantity, now: shortfall.left })
    }
  }
  if (removed.length) await deleteLineItemsWorkflow(container).run({ input: { cart_id: cartId, ids: removed } })
  // One line at a time: each update is a workflow on the same cart.
  for (const { id, quantity } of reduced) {
    await updateLineItemInCartWorkflow(container).run({ input: { cart_id: cartId, item_id: id, update: { quantity } } })
  }

  for (const seller of await dropGoneDeliveries(scope, cartId)) {
    changes.push({ type: "delivery_removed", seller })
    causes.add("delivery")
  }

  const { result } = await applyShopPromotionsWorkflow(container).run({ input: { cart_id: cartId } })
  for (const code of result.used_up) {
    changes.push({ type: "code_removed", code })
    causes.add("code_used_up")
  }
  return { changes, causes }
}

/**
 * Deletes the cart's payment sessions once its payment is refunded, so nothing completes it on
 * the refunded payment (Paystack sending the webhook again): the buyer pays the fixed cart with
 * a new one.
 */
export async function deleteCartSessions(scope: Scope, cartId: string) {
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "cart",
    fields: ["payment_collection.payment_sessions.id"],
    filters: { id: cartId },
  })
  const cart = data[0] as { payment_collection?: { payment_sessions?: { id: string }[] | null } | null } | undefined
  const ids = (cart?.payment_collection?.payment_sessions ?? []).map((s) => s.id)
  if (ids.length) await deletePaymentSessionsWorkflow(scope as MedusaContainer).run({ input: { ids } })
}

/** Takes off the cart each delivery whose shipping option is gone; returns the shops they were for (null when unknown). */
async function dropGoneDeliveries(scope: Scope, cartId: string): Promise<(string | null)[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["shipping_methods.id", "shipping_methods.shipping_option_id"],
    filters: { id: cartId },
  })
  const methods = ((data[0] as { shipping_methods?: { id: string; shipping_option_id: string | null }[] | null })?.shipping_methods ??
    []) as { id: string; shipping_option_id: string | null }[]
  const optionIds = methods.flatMap((m) => (m.shipping_option_id ? [m.shipping_option_id] : []))
  const { data: options } = optionIds.length
    ? await query.graph({ entity: "shipping_option", fields: ["id"], filters: { id: optionIds } })
    : { data: [] }
  const live = new Set((options as { id: string }[]).map((o) => o.id))
  const gone = methods.filter((m) => !m.shipping_option_id || !live.has(m.shipping_option_id))
  if (!gone.length) return []
  await removeCartDeliveriesWorkflow(scope as MedusaContainer).run({
    input: { cart_id: cartId, shipping_method_ids: gone.map((m) => m.id) },
  })
  // A deleted option no longer names its shop.
  return gone.map(() => null)
}
