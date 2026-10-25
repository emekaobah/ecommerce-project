import { cancelledBy, cancelReasonText } from "./cancellation"
import { dateLabel } from "./date-label"
import type { Cancellation, FulfilmentMethod, FulfilmentState } from "./fulfilment"
import { formatMoney } from "./money"
import { orderNumber } from "./order-number"
import type { StatusView } from "./status"
import type { TimelineStep } from "./timeline"

/**
 * How the buyer app shows its order history (#17): each checkout is an order group, split into
 * one order per shop, each with its own state, and its refund if the shop rejected it.
 */

export type OrderFulfilmentView = {
  state: FulfilmentState
  rejected_by: "seller" | "accept_deadline" | null
  reject_reason: string | null
  /** Who cancelled an accepted order and why (#17); null unless it is cancelled. */
  cancellation: Pick<Cancellation, "by" | "reason" | "note"> | null
}

/** What the buyer is told of each state; staff's finer steps read as one to the buyer. */
const STATES: Record<Exclude<FulfilmentState, "rejected" | "cancelled">, Omit<StatusView, "note">> = {
  new: { label: "Waiting for the shop", tone: "new", icon: "clock" },
  accepted: { label: "Accepted", tone: "info", icon: "box" },
  picking: { label: "Being prepared", tone: "info", icon: "box" },
  partially_available: { label: "Being prepared", tone: "info", icon: "box" },
  packed: { label: "Packed", tone: "info", icon: "box" },
  label_booked: { label: "Courier booked", tone: "info", icon: "truck" },
  courier_confirmed: { label: "Courier booked", tone: "info", icon: "truck" },
  handed_to_courier: { label: "On its way", tone: "info", icon: "truck" },
  in_transit: { label: "On its way", tone: "info", icon: "truck" },
  delivered: { label: "Delivered", tone: "success", icon: "check" },
  // Ready is the buyer's cue to come for it.
  ready_for_pickup: { label: "Ready for pickup", tone: "success", icon: "store" },
  collected: { label: "Collected", tone: "success", icon: "check" },
  // The hold expired (#32): the shop kept what was fresh, the rest is refunded.
  not_collected: { label: "Not collected", tone: "neutral", icon: "x" },
}

/** Paystack's refund statuses (`order_refund.status`). */
export type RefundStatus = "pending" | "processing" | "processed" | "failed" | "needs-attention"
export type OrderRefundView = { amount: number; status: RefundStatus }

const REFUNDS: Record<RefundStatus, StatusView> = {
  pending: { label: "Refund on its way", tone: "success", icon: "check", note: null },
  processing: { label: "Refund on its way", tone: "success", icon: "check", note: null },
  processed: { label: "Refunded", tone: "success", icon: "check", note: null },
  // The accept-deadline job refunds it again (#20).
  failed: { label: "Refund delayed", tone: "new", icon: "clock", note: "It didn't go through, so we're trying again." },
  // Paystack needs the buyer's bank account to retry it (#13); after 7 days Oja's team sends it.
  "needs-attention": {
    label: "Refund delayed · add your bank",
    tone: "attention",
    icon: "info",
    note: "Your bank couldn't take it back to your card. Add a bank account to receive it.",
  },
}

/** Where a rejected order's refund is, as its buyer reads it; null while there is none. */
export function refundStatus(refund: OrderRefundView | null): StatusView | null {
  return refund ? REFUNDS[refund.status] : null
}

/**
 * Where a refund an order owes its buyer is (#16): `retrying` while the retry job still tries
 * it, `manual` once Oja's team sends it themselves (Paystack can't make it, or every retry failed).
 */
export type OwedRefundState = "retrying" | "manual"

/** A refund the order owes its buyer and hasn't made (#16), and where it is. */
export type OwedRefundView = { amount: number; state: OwedRefundState }

/** Where a refund the order still owes is, as its buyer reads it; null while it owes none. */
export function owedRefundStatus(owed: OwedRefundView | null, currencyCode: string): StatusView | null {
  if (!owed) return null
  const amount = formatMoney(owed.amount, currencyCode)
  return {
    label: "Refund pending",
    tone: "new",
    icon: "clock",
    note: owed.state === "manual" ? `Our team is sending your ${amount} refund` : `Refund of ${amount} pending`,
  }
}

/** Where a shop's order is, as its buyer reads it; a rejected or cancelled order says why. */
export function orderStatus({ fulfilment }: { fulfilment: OrderFulfilmentView }): StatusView {
  if (fulfilment.state === "cancelled") {
    const { cancellation } = fulfilment
    const label = `Cancelled by ${cancelledBy(cancellation?.by ?? "seller")}`
    return { label, tone: "neutral", icon: "x", note: cancellation ? cancelReasonText(cancellation) : null }
  }
  if (fulfilment.state !== "rejected") return { ...STATES[fulfilment.state], note: null }
  if (fulfilment.rejected_by === "accept_deadline") return { label: "Not accepted in time", tone: "neutral", icon: "x", note: null }
  return { label: "Rejected by the shop", tone: "neutral", icon: "x", note: fulfilment.reject_reason }
}

/**
 * A shop's state on its card in the order: as `orderStatus` gives it, but a new order's chip
 * reads just "Waiting", beside the shop's name.
 */
export function orderCardStatus(order: { fulfilment: OrderFulfilmentView }): StatusView {
  const status = orderStatus(order)
  return order.fulfilment.state === "new" ? { ...status, label: "Waiting" } : status
}

/**
 * "Delivered Fri 2 Oct": when a delivered or collected order got there, from its timeline's last
 * step reached; null before that, or when that step's time isn't known (never an earlier step's).
 */
export function reachedOnLabel(
  { state, timeline }: { state: FulfilmentState; timeline: readonly TimelineStep[] },
  timeZone: string
): string | null {
  if (state !== "delivered" && state !== "collected") return null
  let at: string | null = null
  for (const step of timeline) if (step.status !== "upcoming") at = step.at
  return at ? `${STATES[state].label} ${dateLabel(at, timeZone)}` : null
}

type GroupLike<O> = { orders: readonly O[] }

/** One row of the order list: a checkout across several shops, or one shop's order on its own. */
export type HistoryEntry<G extends GroupLike<O>, O> =
  | { kind: "group"; group: G; paid_total: number }
  | { kind: "order"; group: G; order: O; paid_total: number }

/**
 * The order list's rows, in the order the groups come (newest first). A group of one order,
 * as paying for one shop's items on its own makes (#65), is shown as that order, with no group
 * level around it.
 */
export function historyEntries<O extends { paid_total: number }, G extends GroupLike<O>>(
  groups: readonly G[]
): HistoryEntry<G, O>[] {
  return groups.flatMap((group): HistoryEntry<G, O>[] => {
    const paid_total = group.orders.reduce((sum, o) => sum + o.paid_total, 0)
    const [only, ...others] = group.orders
    if (!only) return []
    return others.length ? [{ kind: "group", group, paid_total }] : [{ kind: "order", group, order: only, paid_total }]
  })
}

/** A shop's order as the order detail's headline reads it. */
export type SummaryOrder = {
  fulfilment: OrderFulfilmentView
  /** When its closed shop next opens, while the order waits for that (ADR 0004). */
  shop_opens: { at: string; time_zone: string } | null
}

const COUNTS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
const countWord = (n: number) => COUNTS[n - 1] ?? String(n)
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** A shop's order's state in the headline's words: a new order at a closed shop waits for it to open. */
function summaryState(order: SummaryOrder) {
  if (order.fulfilment.state === "new" && order.shop_opens) return "waiting for the shop to open"
  return orderStatus(order).label.toLowerCase()
}

/**
 * The order detail's headline: where each shop's part of the checkout is, counted by state in
 * the order the shops come: "One packed, one waiting for the shop to open". One shop's order
 * reads as its state ("On its way"); shops all at one point read "Both delivered".
 */
export function orderGroupSummary(orders: readonly SummaryOrder[]): string {
  const counts = new Map<string, number>()
  for (const order of orders) {
    const state = summaryState(order)
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  const [only, ...others] = [...counts]
  if (only && !others.length) {
    const [state, n] = only
    if (n === 1) return capitalise(state)
    const all = n === 2 ? "both" : `all ${countWord(n)}`
    return capitalise(`${all} ${state}`)
  }
  return capitalise([...counts].map(([state, n]) => `${countWord(n)} ${state}`).join(", "))
}

/**
 * A line of a shop's order as its notes name it: what was bought, the units still on the order
 * (`quantity`) and those the shop didn't have (`unavailable_quantity`).
 */
export type NotedLine = { id: string; product_title: string | null; quantity: number; unavailable_quantity: number }

/** A refund's part of an order line: which line, and how many of its units. */
export type RefundedLine = { item_id: string; quantity: number }

/** `name`, or, for some of a line's units only, how many of it: "2 of 3 Fresh Tomatoes 1kg". */
function unitsOf(units: number, line: NotedLine, name: string) {
  const bought = line.quantity + line.unavailable_quantity
  return units < bought ? `${units} of ${bought} ${name}` : name
}

/** A shop's order as its missing-items note reads it (#22, #61). */
export type MissingItemsOrder = {
  items: readonly NotedLine[]
  /** Each refund of the order, with the lines it was for; null lines for one of no lines. */
  refunds: readonly (OrderRefundView & { lines: readonly RefundedLine[] | null })[]
  currency_code: string
}

/** What the shop didn't have, and where the money for it is; the first sentence leads. */
export type MissingItemsNote = { missing: string; refund: string | null }

/**
 * What a shop's order is missing, in plain words: "Fresh Tomatoes 1kg wasn't available.", and
 * the refund for it: "₦3,500 is on its way back to your card." Null while nothing is missing.
 */
export function missingItemsNote({ items, refunds, currency_code }: MissingItemsOrder): MissingItemsNote | null {
  const missing = items.filter((item) => item.unavailable_quantity > 0)
  const [first, ...others] = missing
  if (!first) return null
  const plural = others.length > 0 || (first.quantity > 0 && first.unavailable_quantity > 1)
  const ids = new Set(missing.map((item) => item.id))
  const forMissing = refunds.filter((refund) => refund.lines?.some((line) => ids.has(line.item_id)))
  return {
    missing: `${listed(missing.map(missingName))} ${plural ? "weren't" : "wasn't"} available.`,
    refund: refundSentence(forMissing, currency_code),
  }
}

/** A missing line by name; part of a line says how many of it: "2 of 3 Fresh Tomatoes 1kg". */
function missingName(item: NotedLine) {
  return unitsOf(item.unavailable_quantity, item, item.product_title ?? "An item")
}

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]) {
  const last = names.at(-1) ?? ""
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${last}` : last
}

/**
 * Where the refund for missing items is: on its way while Paystack works on it, refunded once
 * made (banks take a few working days to show it; no date is promised). A delayed refund is
 * left to its chip, and to the bank-details screen when it waits on the buyer.
 */
function refundSentence(refunds: MissingItemsOrder["refunds"], currencyCode: string) {
  if (!refunds.length) return null
  if (refunds.some((refund) => refund.status === "failed" || refund.status === "needs-attention")) return null
  const amount = formatMoney(
    refunds.reduce((sum, refund) => sum + refund.amount, 0),
    currencyCode
  )
  return refunds.every((refund) => refund.status === "processed")
    ? `${amount} has been refunded to your card.`
    : `${amount} is on its way back to your card.`
}

/** A refund as its screen says what it was for (#95): the lines it names, and the order they're on. */
export type RefundForOrder = {
  /** The lines the refund was for, with units of each; null for a refund of no lines (of delivery alone). */
  lines: readonly RefundedLine[] | null
  /** The order's lines, to name them by; null while they aren't known. */
  items: readonly (NotedLine & { variant_title: string | null })[] | null
  /** The checkout's (order group's) `display_id`, the number the buyer sees everywhere; null while it isn't known. */
  group_display_id: number | null
  shop: string
}

/**
 * What a refund was for, in plain words: "For Fresh Tomatoes 1kg in OJ-2301." Part of a line
 * says how many of it. A refund of no lines, or of lines not known here, is for the order:
 * "For your order OJ-2301 from Iya Bisi Foodstuff."
 */
export function refundForNote({ lines, items, group_display_id, shop }: RefundForOrder): string {
  const named = (lines ?? []).flatMap((line) => {
    const item = items?.find((i) => i.id === line.item_id)
    return item ? [unitsOf(line.quantity, item, orderLineName(item))] : []
  })
  const number = group_display_id === null ? null : orderNumber(group_display_id)
  if (!lines?.length || named.length < lines.length) {
    return number === null ? `For your order from ${shop}.` : `For your order ${number} from ${shop}.`
  }
  const what = listed(named)
  return number === null ? `For ${what} from ${shop}.` : `For ${what} in ${number}.`
}

/** A line of an order by name: "Adire Kaftan · M"; a product's only variant usually shares its name, which isn't repeated. */
export function orderLineName({ product_title, variant_title }: { product_title: string | null; variant_title: string | null }): string {
  const name = product_title ?? "Item"
  return variant_title && variant_title !== product_title ? `${name} · ${variant_title}` : name
}

/** One dot of an order's progress bar, named for screen readers. */
export type ProgressStep = { label: string; status: "done" | "current" | "upcoming" }

const PROGRESS: Record<FulfilmentMethod, { labels: readonly string[]; at: Partial<Record<FulfilmentState, number>> }> = {
  delivery: {
    labels: ["Accepted", "Being prepared", "Packed", "On its way"],
    at: { accepted: 0, picking: 1, partially_available: 1, packed: 2, label_booked: 2, courier_confirmed: 2, handed_to_courier: 3, in_transit: 3 },
  },
  pickup: {
    labels: ["Accepted", "Being prepared", "Ready for pickup", "Collected"],
    at: { accepted: 0, picking: 1, partially_available: 1, ready_for_pickup: 2 },
  },
}

/**
 * A shop's order's progress as the order detail's four-dot bar draws it ("Order detail"): done up
 * to where it is, which is current. Null while it waits for the shop, and once it is over
 * (delivered, collected, not collected, rejected or cancelled): its chip says so.
 */
export function orderProgress(state: FulfilmentState, method: FulfilmentMethod): ProgressStep[] | null {
  const { labels, at } = PROGRESS[method]
  const current = at[state]
  if (current === undefined) return null
  return labels.map((label, i) => ({ label, status: stepStatus(i, current) }))
}

function stepStatus(step: number, current: number): ProgressStep["status"] {
  if (step < current) return "done"
  return step === current ? "current" : "upcoming"
}

const OVER = new Set<FulfilmentState>(["delivered", "collected", "not_collected", "rejected", "cancelled"])

/** Whether every shop's part of a checkout is over: its order detail then reads as a receipt, with no band ("Delivered order"). */
export function orderGroupSettled(orders: readonly { fulfilment: { state: FulfilmentState } }[]): boolean {
  return orders.every((order) => OVER.has(order.fulfilment.state))
}
