import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
// Every amount is worked out in kobo (the currency's subunit) to stay exact.
import { fromSubunit, toSubunit } from "../modules/paystack/client"
import { fulfilmentService } from "./order-fulfilment"

// Who pays for a discount (#6, docs/adr/0010-promotions.md). A shop's own promotion comes out of
// its payout; one the operator runs is Oja's, unless the operator set who covers it on the
// promotion (Mercur's promotion cost: the shop, Oja, or shared). Each order records the share
// when it is placed, so changing a promotion later doesn't change orders already made.

/** Mercur's promotion cost, as the operator set it in the admin panel. */
export type PromotionCost = {
  cost_bearer: "store" | "marketplace" | "shared"
  shared_marketplace_percentage: number | null
}

/** Oja's share of a promotion's discounts, in percent: the rest is the shop's. */
export function ojaShareOf({ sellerId, cost }: { sellerId: string | null; cost: PromotionCost | null }): number {
  if (cost?.cost_bearer === "marketplace") return 100
  if (cost?.cost_bearer === "shared") return cost.shared_marketplace_percentage ?? 0
  if (cost?.cost_bearer === "store") return 0
  return sellerId ? 0 : 100
}

/**
 * An order's line with its discounts, and how many of it were removed since it was placed (#22).
 * An adjustment's amount leaves VAT out unless its promotion includes it; `tax_rate` is the
 * line's VAT, in percent.
 */
export type DiscountedLine = {
  quantity: number
  removed: number
  tax_rate: number
  adjustments: Adjustment[]
}

type Adjustment = { amount: number; is_tax_inclusive: boolean | null; promotion_id: string | null }

/** A line's VAT, in percent: its tax lines' rates. */
export const taxRateOf = (taxLines: { rate: number | string }[] | null | undefined) =>
  (taxLines ?? []).reduce((total, line) => total + Number(line.rate), 0)

/** What each of a line's adjustments takes off it, VAT included, in kobo. */
export function adjustmentTotals(line: { tax_rate: number; adjustments: Omit<Adjustment, "promotion_id">[] }): number[] {
  return line.adjustments.map((a) =>
    a.is_tax_inclusive ? toSubunit(a.amount) : (toSubunit(a.amount) * (100 + line.tax_rate)) / 100
  )
}

/**
 * What Oja funds of the discounts on what the buyer kept: its share of each line's discounts,
 * for the units still on the order. A line's discounts stay as they were for the units it was
 * placed with, so they are counted per unit. A promotion with no recorded share is the shop's.
 */
export function ojaFundedDiscount(lines: DiscountedLine[], shares: Map<string, number>): number {
  const subunits = lines.reduce((total, line) => {
    const placed = line.quantity + line.removed
    if (!placed) return total
    const totals = adjustmentTotals(line)
    return line.adjustments.reduce((sum, adjustment, i) => {
      const share = (adjustment.promotion_id && shares.get(adjustment.promotion_id)) || 0
      return sum + (totals[i]! * share * line.quantity) / (100 * placed)
    }, total)
  }, 0)
  return fromSubunit(Math.round(subunits))
}

type Scope = Pick<MedusaContainer, "resolve">

type PromotionRow = {
  id: string
  code: string | null
  seller?: { id: string } | null
  promotion_cost?: PromotionCost | null
}

/** The promotions discounting the order's items, each with Oja's share of it as it stands now. */
export async function fundingToRecord(
  scope: Scope,
  orderId: string
): Promise<{ promotion_id: string; code: string | null; oja_share: number }[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "items.adjustments.promotion_id"],
    filters: { id: orderId },
  })
  const order = orders[0] as unknown as { items?: { adjustments?: { promotion_id: string | null }[] | null }[] | null }
  const promotionIds = [
    ...new Set((order?.items ?? []).flatMap((i) => (i.adjustments ?? []).flatMap((a) => a.promotion_id ?? []))),
  ]
  if (!promotionIds.length) return []
  const { data } = await query.graph({
    entity: "promotion",
    fields: ["id", "code", "seller.id", "promotion_cost.cost_bearer", "promotion_cost.shared_marketplace_percentage"],
    filters: { id: promotionIds },
    // A promotion deleted since the cart was paid still funds its discounts.
    withDeleted: true,
  })
  return (data as unknown as PromotionRow[]).map((p) => ({
    promotion_id: p.id,
    code: p.code,
    oja_share: ojaShareOf({ sellerId: p.seller?.id ?? null, cost: p.promotion_cost ?? null }),
  }))
}

/** Oja's share of each promotion on each order, by order and then promotion id, as recorded when it was placed. */
export async function ojaSharesOf(scope: Scope, orderIds: string[]): Promise<Map<string, Map<string, number>>> {
  const shares = new Map<string, Map<string, number>>()
  if (!orderIds.length) return shares
  const rows = await fulfilmentService(scope).listDiscountFundings({ order_id: orderIds })
  for (const row of rows) {
    const order = shares.get(row.order_id) ?? new Map<string, number>()
    order.set(row.promotion_id, Number(row.oja_share))
    shares.set(row.order_id, order)
  }
  return shares
}
