import { acceptDeadline, acceptTimeLeft } from "./accept-deadline"
import { clip } from "./buyer-activity"
import type { OrderStage } from "./order-stage"
import type { ShopHours } from "./shop-hours"

/**
 * What a shop's Live Activity shows on a member's phone (#133). The backend pushes it; the widget
 * only draws it. The countdown is the phone's own timer, counting to `deadline`, so the deadline
 * is an absolute time and needs no push to tick.
 */

/** The name the activity's layout is registered under, in the app and in Apple's payload. */
export const VENDOR_ACTIVITY_FACTORY = "ShopOrdersActivity"

const MAX_SHOP = 80

/** The new order to accept soonest: when, and whether it's in its last two hours. */
export type NearestDeadline = { at: string; urgent: boolean }

export type VendorActivityShop = {
  shop: string
  /** The stage tiles' counts: `stageCounts` on the server. */
  counts: Record<OrderStage, number>
  deadline: NearestDeadline | null
}

export type VendorActivityContent = {
  shop: string
  counts: Record<OrderStage, number>
  /** ISO 8601. Null with no new order to accept, or one the shop won't reopen to finish. */
  deadline: string | null
  urgent: boolean
}

export function vendorActivityContent({ shop, counts, deadline }: VendorActivityShop): VendorActivityContent {
  return { shop: clip(shop, MAX_SHOP), counts, deadline: deadline?.at ?? null, urgent: deadline?.urgent ?? false }
}

/**
 * The nearest accept deadline of a shop's new orders, from when each was placed (ISO 8601). Its
 * urgency is the time chip's (`acceptClockStatus`), counted in the shop's open hours.
 */
export function nearestAcceptDeadline(placedAt: string[], now: Date, hours: ShopHours | null): NearestDeadline | null {
  const deadlines = placedAt.map((placed) => acceptDeadline(placed, hours)).filter((at): at is string => at !== null)
  if (!deadlines.length) return null
  const at = deadlines.reduce((nearest, deadline) => (Date.parse(deadline) < Date.parse(nearest) ? deadline : nearest))
  return { at, urgent: acceptTimeLeft(at, now, hours).urgent }
}
