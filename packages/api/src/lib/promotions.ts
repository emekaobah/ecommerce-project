import type { ComputeActions } from "@medusajs/framework/types"
import { ComputedActions } from "@medusajs/framework/utils"

// A cart's promotions, worked out shop by shop (#6, docs/adr/0010-promotions.md). Medusa works
// a cart's promotions out over all its items, and Mercur only drops a shop's discounts from other
// shops' items afterwards: a shop's fixed amount spread across the cart then shrinks, and Medusa
// works them out again that way on every change to the cart. Here a shop's promotions are worked
// out on its own items alone, and the operator's on the whole cart.

/** Whose promotion a code is: a shop's, or the operator's (`seller_id` null). */
export type PromotionOwner = { id: string; seller_id: string | null }

/** One working-out of the cart's promotions: on one shop's items, or (`seller_id` null) on the whole cart. */
export type PromotionPass = { seller_id: string | null; actions: ComputeActions[] }

export type ItemAdjustment = { code: string; promotion_id: string; item_id: string; amount: number; is_tax_inclusive: boolean }
export type ShippingAdjustment = { code: string; promotion_id: string; shipping_method_id: string; amount: number }

export type ShopAdjustments = {
  items: ItemAdjustment[]
  shipping: ShippingAdjustment[]
  /** The codes with a discount on the cart, in the order first applied. */
  codes: string[]
  /** Codes whose promotion or campaign is used up. */
  used_up: string[]
}

/**
 * The cart's adjustments from its passes: each pass keeps only its own promotions' (a shop's
 * pass its promotions, the cart's pass the operator's). Delivery is Oja's, so only the operator's
 * promotions discount it. Two promotions stacked on an item never take it below nothing: `caps`
 * is the most each item can be discounted.
 */
export function shopAdjustments({
  passes,
  owners,
  caps,
}: {
  passes: PromotionPass[]
  owners: Map<string, PromotionOwner>
  caps: Map<string, number>
}): ShopAdjustments {
  const result: ShopAdjustments = { items: [], shipping: [], codes: [], used_up: [] }
  const discounted = new Map<string, number>()
  for (const { seller_id, actions } of passes) {
    for (const action of actions) {
      const owner = owners.get(action.code)
      if (owner?.seller_id === seller_id) keepAction(result, { action, owner, operatorPass: seller_id === null, caps, discounted })
    }
  }
  return result
}

const addOnce = (list: string[], code: string) => {
  if (!list.includes(code)) list.push(code)
}

/** Adds one of a pass's own actions to the cart's adjustments: `discounted` is what each item has had taken off so far. */
function keepAction(
  result: ShopAdjustments,
  {
    action,
    owner,
    operatorPass,
    caps,
    discounted,
  }: {
    action: ComputeActions
    owner: PromotionOwner
    operatorPass: boolean
    caps: Map<string, number>
    discounted: Map<string, number>
  }
) {
  if (action.action === ComputedActions.ADD_ITEM_ADJUSTMENT) {
    const already = discounted.get(action.item_id) ?? 0
    const amount = Math.min(Number(action.amount), (caps.get(action.item_id) ?? 0) - already)
    if (amount <= 0) return
    discounted.set(action.item_id, already + amount)
    result.items.push({
      code: action.code,
      promotion_id: owner.id,
      item_id: action.item_id,
      amount,
      is_tax_inclusive: !!action.is_tax_inclusive,
    })
    addOnce(result.codes, action.code)
  } else if (action.action === ComputedActions.ADD_SHIPPING_METHOD_ADJUSTMENT && operatorPass) {
    result.shipping.push({
      code: action.code,
      promotion_id: owner.id,
      shipping_method_id: action.shipping_method_id,
      amount: Number(action.amount),
    })
    addOnce(result.codes, action.code)
  } else if (
    action.action === ComputedActions.PROMOTION_LIMIT_EXCEEDED ||
    action.action === ComputedActions.CAMPAIGN_BUDGET_EXCEEDED
  ) {
    addOnce(result.used_up, action.code)
  }
}

/** A promotion as a buyer's code finds it, with what decides whether it can be used now. */
export type CodedPromotion = {
  code: string
  status: "draft" | "active" | "inactive"
  limit: number | null
  used: number
  campaign: {
    starts_at: string | Date | null
    ends_at: string | Date | null
    budget: { type: "spend" | "usage" | "use_by_attribute"; limit: number | null; used: number } | null
  } | null
}

/**
 * Why a buyer can't use a code now, or null when they can (whether it discounts anything in
 * their cart is worked out on the cart). `typed` is the code as the buyer typed it.
 */
export function promoCodeProblem(promotion: CodedPromotion | null, typed: string, now: Date): string | null {
  if (!promotion || promotion.status === "draft") {
    return `"${typed.toUpperCase()}" isn't a valid promo code. Check it and try again.`
  }
  const { code, campaign } = promotion
  const at = (date: string | Date | null) => (date ? new Date(date).getTime() : null)
  const endsAt = at(campaign?.ends_at ?? null)
  if (promotion.status === "inactive" || (endsAt !== null && endsAt <= now.getTime())) return `"${code}" has expired.`
  const startsAt = at(campaign?.starts_at ?? null)
  if (startsAt !== null && startsAt > now.getTime()) return `"${code}" isn't on yet.`
  const budget = campaign?.budget
  const budgetUsed = budget && budget.type !== "use_by_attribute" && budget.limit != null && budget.used >= budget.limit
  if ((promotion.limit != null && promotion.used >= promotion.limit) || budgetUsed) return `"${code}" has been used up.`
  return null
}
