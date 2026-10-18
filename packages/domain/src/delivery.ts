/**
 * Delivery choices at checkout (#23): of a shop's courier rates, the buyer is offered the
 * cheapest, the fastest and the best value, with best value preselected (docs/design.md).
 */

import type { FulfilmentState } from "./fulfilment"
import { nextOpening, type ShopHours } from "./shop-hours"

/** A courier's quote for one shop's parcel. `delivery_eta_time` is ISO 8601. */
export type DeliveryRate = {
  id: string
  amount: number
  delivery_eta_time: string
  /** How well the courier tracks parcels, 1–10 (Shipbubble's `tracking_level`). */
  tracking_level?: number | null
}

export type DeliveryTag = "best_value" | "cheapest" | "fastest"

export type DeliveryChoice<R extends DeliveryRate = DeliveryRate> = R & { tags: DeliveryTag[] }

const DAY_MS = 24 * 60 * 60 * 1000

/** Best value may arrive up to this much later than the fastest rate. */
const BEST_VALUE_SLACK_MS = DAY_MS

const eta = (rate: DeliveryRate) => Date.parse(rate.delivery_eta_time)

/** The first of non-empty `rates` in `compare` order. */
const first = <R>(rates: R[], compare: (a: R, b: R) => number): R => [...rates].sort(compare)[0]!

/**
 * The rates to offer: best value, then the cheapest, then the fastest, a rate that is several
 * of them offered once with each tag. Best value is the cheapest rate arriving within a day of
 * the fastest one, the better-tracked courier when prices tie.
 */
export function deliveryChoices<R extends DeliveryRate>(rates: R[]): DeliveryChoice<R>[] {
  if (!rates.length) return []
  const fastest = first(rates, (a, b) => eta(a) - eta(b) || a.amount - b.amount)
  const cheapest = first(rates, (a, b) => a.amount - b.amount || eta(a) - eta(b))
  const bestValue = first(
    rates.filter((r) => eta(r) <= eta(fastest) + BEST_VALUE_SLACK_MS),
    (a, b) => a.amount - b.amount || (b.tracking_level ?? 0) - (a.tracking_level ?? 0) || eta(a) - eta(b)
  )

  const choices: DeliveryChoice<R>[] = []
  const tag = (rate: R, name: DeliveryTag) => {
    const existing = choices.find((c) => c.id === rate.id)
    if (existing) existing.tags.push(name)
    else choices.push({ ...rate, tags: [name] })
  }
  tag(bestValue, "best_value")
  tag(cheapest, "cheapest")
  tag(fastest, "fastest")
  return choices
}

/** The calendar date of an instant in a timezone, as YYYY-MM-DD. */
const dateIn = (instant: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(instant)

/**
 * When a parcel arrives, as the buyer reads it: "Arrives today", "Arrives tomorrow", or
 * "Arrives Wed 7 Oct". Days are counted in the region's timezone.
 */
export function deliveryEstimate(etaTime: string, now: Date, timeZone: string): string {
  const arrives = new Date(etaTime)
  const days = Math.round((Date.parse(dateIn(arrives, timeZone)) - Date.parse(dateIn(now, timeZone))) / DAY_MS)
  if (days <= 0) return "Arrives today"
  if (days === 1) return "Arrives tomorrow"
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" })
  return `Arrives ${date.format(arrives).replace(",", "")}`
}

/**
 * When a shop's delivery estimate starts (ADR 0004): now while it is open, else its next
 * opening, when the order is prepared and a courier can collect it. Now for a shop without
 * hours, or one not set to reopen, which takes no orders.
 */
export function deliveryStartsAt(hours: ShopHours | null, now: Date): Date {
  return (hours && nextOpening(hours, now)) || now
}

/**
 * A courier's ETA (ISO 8601), counted from its collection at `pickupTime` (ISO 8601), moved so
 * the parcel is collected no sooner than `startsAt`: later by however long before it the courier
 * would collect. As it is when the courier collects at `startsAt` or after, or gives no time.
 */
export const etaCountedFrom = (etaTime: string, pickupTime: string | null | undefined, startsAt: Date): Date => {
  const eta = Date.parse(etaTime)
  return new Date(pickupTime ? eta + Math.max(0, startsAt.getTime() - Date.parse(pickupTime)) : eta)
}

/**
 * A delivered order's courier and when it arrives (ISO 8601), as checkout quoted it or, once a
 * label is booked, as the booked courier did, with the timezone its days are counted in.
 * `switched_from`: the courier the buyer chose at checkout, when another was booked (#19).
 */
export type OrderDelivery = { courier_name: string; delivery_eta_time: string; time_zone: string; switched_from: string | null }

/** States in which a delivered order has arrived, or won't. */
const NOT_ARRIVING = new Set<FulfilmentState>(["delivered", "rejected", "cancelled"])

/**
 * "Arrives Wed 7 Oct · GIG Next Day": when the buyer's order arrives, as checkout quoted it
 * (counted from the shop's next opening, ADR 0004) or the booked courier did. Null once it has
 * arrived or won't, and for an order without a delivery.
 */
export function orderArrival(state: FulfilmentState, delivery: OrderDelivery | null, now: Date): string | null {
  if (!delivery || NOT_ARRIVING.has(state)) return null
  return `${deliveryEstimate(delivery.delivery_eta_time, now, delivery.time_zone)} · ${delivery.courier_name}`
}

/**
 * When the order's label was booked with another courier than the buyer chose at checkout
 * (#19), which, until the order has arrived: the platform paid any difference. Null otherwise.
 */
export function courierChangedNote(state: FulfilmentState, delivery: OrderDelivery | null): string | null {
  if (!delivery?.switched_from || NOT_ARRIVING.has(state)) return null
  return `${delivery.switched_from} couldn't take your order, so it's shipping with ${delivery.courier_name} at no extra cost.`
}
