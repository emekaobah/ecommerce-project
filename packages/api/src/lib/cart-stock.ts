import type { MedusaContainer } from "@medusajs/framework/types"
import { deleteLineItemsWorkflow, updateLineItemInCartWorkflow } from "@medusajs/medusa/core-flows"
import { stockShortfall, type NotPlacedChange } from "@oja/domain"
import type { CartItem } from "./cart"
import type { CartLineCheck } from "./cart-line-check"

// Cutting a cart to what its shops have left: starting payment does it before charging (#67), and
// fixing a paid cart that wasn't placed does it after refunding (#38). Either way the buyer sees
// what changed, in the not-placed change shape, and pays the new total.

/** What cutting a line needs to know of it: where it stands (`checkCartLines`), or its cart group's line. */
export type StockLine = Pick<CartLineCheck, "line_item_id" | "product_title" | "variant_title" | "quantity" | "available_quantity"> & {
  seller: { id: string; name: string } | null
}

/** A cart group's line as cutting it to stock sees it, with the group's shop. */
export const stockLineOf = <S extends StockLine["seller"]>(item: CartItem, seller: S) => ({
  line_item_id: item.id,
  product_title: item.product_title,
  variant_title: item.variant_title,
  quantity: item.quantity,
  available_quantity: item.available_quantity,
  seller,
})

/**
 * Removes the cart's sold-out lines and cuts those wanting more than is left to what is, from
 * what each line's offer has left. Lines whose shop is gone are not this function's to fix.
 * Returns what changed, and the shops whose lines it changed.
 */
export async function cutCartToStock(
  container: MedusaContainer,
  cartId: string,
  lines: StockLine[]
): Promise<{ changes: NotPlacedChange[]; sellerIds: Set<string> }> {
  const changes: NotPlacedChange[] = []
  const sellerIds = new Set<string>()
  const removed: string[] = []
  const reduced: { id: string; quantity: number }[] = []
  for (const line of lines) {
    if (!line.seller) continue
    const shortfall = stockShortfall(line.quantity, line.available_quantity)
    if (!shortfall) continue
    sellerIds.add(line.seller.id)
    const item = { product_title: line.product_title, variant_title: line.variant_title, seller: line.seller.name }
    if (shortfall.type === "sold_out") {
      removed.push(line.line_item_id)
      changes.push({ type: "item_removed", ...item, quantity: line.quantity })
    } else {
      reduced.push({ id: line.line_item_id, quantity: shortfall.left })
      changes.push({ type: "quantity_reduced", ...item, was: line.quantity, now: shortfall.left })
    }
  }
  if (removed.length) await deleteLineItemsWorkflow(container).run({ input: { cart_id: cartId, ids: removed } })
  // One line at a time: each update is a workflow on the same cart.
  for (const { id, quantity } of reduced) {
    await updateLineItemInCartWorkflow(container).run({ input: { cart_id: cartId, item_id: id, update: { quantity } } })
  }
  return { changes, sellerIds }
}
