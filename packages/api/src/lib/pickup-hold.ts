import { collectBy, type ShopHours } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { FulfilmentRecord } from "./order-fulfilment"
import { perishableProductIds } from "./perishable"

// A pickup order nobody collects (#32, docs/design.md → Pickup): it is held for the shop's open
// days, then is Not collected. Its non-perishable lines are refunded and their stock returned;
// its perishable lines are the shop's, paid out less commission. The job that ends holds is
// `expirePickupHolds` (`lib/pickup-hold-expiry`).

type Scope = Pick<MedusaContainer, "resolve">

/** Why the order's non-perishable lines were refunded. */
export const NOT_COLLECTED_NOTE = "Not collected in time"

/** When a pickup order's hold ends (ISO 8601), and the region's timezone. */
export type CollectBy = { at: string; time_zone: string }

/**
 * When the order's hold ends, while it is Ready for pickup, counted in the shop's `hours` from
 * when it became Ready; its `lines` (those still on it) set how long. Null without either.
 */
export function collectByOf(
  record: Pick<FulfilmentRecord, "state" | "reached"> | undefined,
  hours: ShopHours | null,
  lines: { perishable: boolean }[] | undefined
): CollectBy | null {
  const readyAt = record?.reached?.ready_for_pickup
  if (record?.state !== "ready_for_pickup" || !readyAt || !hours || !lines) return null
  const at = collectBy(hours, readyAt, lines)
  return at ? { at, time_zone: hours.time_zone } : null
}

/** An order line as the order graph gives it: its quantity now is on its detail, which an order edit changes. */
export type OrderLineRow = {
  id: string
  product_id?: string | null
  quantity?: unknown
  detail?: { quantity?: unknown } | null
} | null

/** A line still on an order, and whether it is perishable (#69). */
export type HoldLine = { id: string; quantity: number; perishable: boolean }

/** The order graph fields `holdLinesOf` reads. */
export const HOLD_LINE_FIELDS = ["items.id", "items.product_id", "items.quantity", "items.detail.quantity"]

/** Each order's lines still on it, with whether each is perishable, which sets the order's hold. */
export async function holdLinesOf(
  scope: Scope,
  orders: { id: string; items?: OrderLineRow[] | null }[]
): Promise<Map<string, HoldLine[]>> {
  const rows = orders.map((o) => ({ id: o.id, items: (o.items ?? []).flatMap((i) => (i ? [i] : [])) }))
  const perishable = await perishableProductIds(
    scope,
    rows.flatMap((o) => o.items.flatMap((i) => (i.product_id ? [i.product_id] : [])))
  )
  return new Map(
    rows.map((o) => [
      o.id,
      o.items
        .map((i) => ({
          id: i.id,
          quantity: Number(i.detail?.quantity ?? i.quantity ?? 0),
          perishable: !!i.product_id && perishable.has(i.product_id),
        }))
        .filter((l) => l.quantity > 0),
    ])
  )
}
