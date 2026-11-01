import { namedItems, type RemovedItem } from "./buyer-push"
import { cancelReasonText } from "./cancellation"
import type { Cancellation, FulfilmentMethod, FulfilmentState } from "./fulfilment"
import { formatMoney } from "./money"
import { orderStatus } from "./order-history"
import { pickupCodeGroups } from "./pickup"
import type { StatusSymbol, StatusTone } from "./status"
import { fulfilmentTimeline, shortStepLabel } from "./timeline"

/**
 * What a buyer's Live Activity shows of one shop's order (#133). The backend pushes it and the
 * buyer app starts it on older iOS, so both say the same; the widget only draws it.
 */

/** The name the activity's layout is registered under, in the app and in Apple's payload. */
export const BUYER_ACTIVITY_FACTORY = "BuyerOrderActivity"

/** A state an activity can be in: it starts once the shop accepts, and rejection comes before that. */
type ActivityState = Exclude<FulfilmentState, "new" | "rejected">

export type BuyerActivityOrder = {
  /** The checkout's number ("OJ-12", `orderNumber`), the one the buyer knows. */
  number: string
  shop: string
  method: FulfilmentMethod
  state: ActivityState
  currency_code: string
  pickup_code?: string | null
  cancellation?: Pick<Cancellation, "by" | "reason" | "note"> | null
  /** What a cancelled or not collected order refunds. */
  refund?: number
  /** A not collected order's fresh items, which aren't refunded. */
  kept?: RemovedItem[]
}

export type BuyerActivityStep = {
  label: string
  /** For the small view (Apple Watch, CarPlay). */
  short: string
  tone: StatusTone
  icon: StatusSymbol
  /** Which step of `total` on the order screen's timeline; 0 for a cancelled order, which left the path. */
  index: number
  total: number
  next: string | null
}

export type BuyerActivityOutcome =
  | { kind: "delivered" | "collected" }
  | { kind: "cancelled"; by: Cancellation["by"]; reason: string; refund: string | null }
  | { kind: "not_collected"; refund: string | null; kept: string | null }

export type BuyerActivityContent = {
  number: string
  shop: string
  method: FulfilmentMethod
  step: BuyerActivityStep
  /** The pickup code, grouped to read out, once the order is ready for pickup. */
  code: string | null
  outcome: BuyerActivityOutcome | null
}

/**
 * Apple refuses a payload over 4 KB. This is the content's share: the rest of the payload is the
 * alert, whose text comes from the same clipped names, and a few short fields.
 */
export const MAX_ACTIVITY_CONTENT_BYTES = 3000

// Longer than anything worth reading on a Lock Screen, and at their worst (every character a
// quote, which costs 4 bytes once the props are a JSON string in JSON) together under the limit.
const MAX_SHOP = 80
const MAX_REASON = 300
const MAX_KEPT = 200

/** The content as Apple's payload carries it: the library's envelope, the props a JSON string. */
export const liveActivityPayloadBytes = (factory: string, props: object) =>
  new TextEncoder().encode(JSON.stringify({ name: factory, props: JSON.stringify(props) })).length

/** Free text on one line, cut to `max` characters at a character's edge, never through an emoji. */
function clip(text: string, max: number) {
  // eslint-disable-next-line no-control-regex
  const line = text.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim()
  const characters = Array.from(line)
  return characters.length <= max ? line : `${characters.slice(0, max - 1).join("").trimEnd()}…`
}

function stepOf({ method, state, cancellation }: BuyerActivityOrder): BuyerActivityStep {
  const status = orderStatus({ fulfilment: { state, rejected_by: null, reject_reason: null, cancellation: cancellation ?? null } })
  const steps = fulfilmentTimeline({ method, state, placed_at: "", reached: {} }, "buyer")
  const reached = steps.filter((step) => step.status !== "upcoming")
  // A cancelled order is on no step of its path, but is still drawn against it.
  const total = steps.length || fulfilmentTimeline({ method, state: "accepted", placed_at: "", reached: {} }, "buyer").length
  const label = reached.at(-1)?.label ?? status.label
  return {
    label,
    short: state === "cancelled" ? "Cancelled" : shortStepLabel(label),
    tone: status.tone,
    icon: status.icon,
    index: reached.length,
    total,
    next: steps[reached.length]?.label ?? null,
  }
}

function outcomeOf({ state, cancellation, refund = 0, kept = [], currency_code }: BuyerActivityOrder): BuyerActivityOutcome | null {
  const refunded = refund > 0 ? formatMoney(refund, currency_code) : null
  if (state === "delivered" || state === "collected") return { kind: state }
  if (state === "cancelled") {
    return {
      kind: "cancelled",
      by: cancellation?.by ?? "seller",
      reason: cancellation ? clip(cancelReasonText(cancellation), MAX_REASON) : "",
      refund: refunded,
    }
  }
  if (state === "not_collected") return { kind: "not_collected", refund: refunded, kept: kept.length ? clip(namedItems(kept), MAX_KEPT) : null }
  return null
}

/**
 * The activity's content at the order's state: the same steps as the order screen's timeline, so
 * the two never disagree, and only what the backend knows. Under Apple's limit whatever the
 * shop's name or a staff member's note holds.
 */
export function buyerActivityContent(order: BuyerActivityOrder): BuyerActivityContent {
  return {
    number: order.number,
    shop: clip(order.shop, MAX_SHOP),
    method: order.method,
    step: stepOf(order),
    code: order.state === "ready_for_pickup" && order.pickup_code ? pickupCodeGroups(order.pickup_code) : null,
    outcome: outcomeOf(order),
  }
}
