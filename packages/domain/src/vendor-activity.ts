import { acceptDeadline, acceptTimeLeft } from "./accept-deadline"
import { clip } from "./buyer-activity"
import { ORDER_STAGES, type OrderStage } from "./order-stage"
import type { ShopHours } from "./shop-hours"

/**
 * What a shop's Live Activity shows on a member's phone (#133). The backend pushes it; the widget
 * only draws it. The countdown is the phone's own timer, counting to `deadline`, so the deadline
 * is an absolute time and needs no push to tick.
 */

/** The name the activity's layout is registered under, in the app and in Apple's payload. */
export const VENDOR_ACTIVITY_FACTORY = "ShopOrdersActivity"

const MAX_SHOP = 80

/**
 * What tapping a shop's activity opens: that shop's orders, acting for it. It also names the shop,
 * because the url is the one thing about an activity that the server sets in its push-to-start and
 * the app can read back (ADR 0018), and it stays the same for the activity's whole life.
 */
export const vendorActivityUrl = (scheme: string, sellerId: string) => `${scheme}://shop-orders/${encodeURIComponent(sellerId)}`

/** The shop an activity's url names. */
export function vendorActivitySellerId(url: string | null | undefined) {
  const match = url?.match(/:\/\/shop-orders\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]!) : null
}

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

/** What was last sent to a phone: the content, and when. */
export type VendorActivitySent = { content: VendorActivityContent; at: Date }

/** At most one batched update in this long. Alerting updates don't wait for it. */
const BATCH_MS = 30 * 1000

const sameContent = (a: VendorActivityContent, b: VendorActivityContent) =>
  a.shop === b.shop && a.deadline === b.deadline && a.urgent === b.urgent && ORDER_STAGES.every((stage) => a.counts[stage] === b.counts[stage])

/**
 * Whether a phone should be sent `current` in the next batch: the shop's content differs from what
 * the phone last got, and the last push was long enough ago. Several changes between two checks are
 * one update. It compares what was sent with what's true now, so nothing has to remember a change.
 */
export function vendorActivityUpdateDue(sent: VendorActivitySent | null, current: VendorActivityContent, now: Date): boolean {
  if (!sent) return true
  return !sameContent(sent.content, current) && now.getTime() - sent.at.getTime() >= BATCH_MS
}

/** The moments that update the activity at once, with an alert (priority 10). */
export type VendorActivityMoment = "new_order" | "deadline_near"

/** What the alert says. It has no sound: the new-order and reminder pushes keep theirs. */
export function vendorActivityAlert(moment: VendorActivityMoment, content: VendorActivityContent): { title: string; body: string } {
  const body = moment === "new_order" ? `New order. ${content.counts.new} waiting to accept.` : "An order has under 2 hours to accept."
  return { title: content.shop, body }
}
