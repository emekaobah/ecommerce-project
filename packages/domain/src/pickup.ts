/**
 * In-store pickup (#12, docs/design.md → Pickup): the code a buyer collects with, how the
 * counter checks it, and what the buyer is told at checkout.
 */

import { openingLabel, WEEKDAYS, type DayHours, type OpenPeriod, type Weekday, type WeeklyHours } from "./shop-hours"

/** A pickup code is this many digits, shown in the buyer's order and as a QR code of them. */
export const PICKUP_CODE_LENGTH = 6
/** How many wrong codes an order takes within `PICKUP_CODE_WINDOW_MS` before it refuses any code. */
export const PICKUP_CODE_ATTEMPTS = 5
export const PICKUP_CODE_WINDOW_MS = 15 * 60 * 1000

/** What the buyer is told before choosing pickup, and on the order. */
export const PICKUP_HOLD_NOTICE = "Collect within 5 open days; fresh items aren't refunded if not collected."
/** Why a shop with fresh items switched to pickup at checkout (`perishable_too_slow`, #69). */
export const PERISHABLE_PICKUP_NOTE = "No courier can get fresh items to you in time — collect in store"

const DAY_LABELS: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" }

/** One day's hours as the buyer reads them. */
const dayHours = (periods: OpenPeriod[]) => {
  if (!periods.length) return "Closed"
  if (periods.length === 1 && periods[0]!.opens === "00:00" && periods[0]!.closes === "24:00") return "Open 24 hours"
  return periods.map((p) => `${p.opens}–${p.closes}`).join(", ")
}

/**
 * A shop's weekly hours as lines for the buyer collecting from it, in week order: consecutive
 * days open the same hours share a line ("Mon–Wed 07:00–20:00").
 */
export function openingHoursLines(weekly: WeeklyHours): string[] {
  const runs: { from: Weekday; to: Weekday; hours: string }[] = []
  for (const day of WEEKDAYS) {
    const hours = dayHours(weekly[day])
    const last = runs.at(-1)
    if (last?.hours === hours) last.to = day
    else runs.push({ from: day, to: day, hours })
  }
  return runs.map(({ from, to, hours }) => `${dayRange(from, to)} ${hours}`)
}

const dayRange = (from: Weekday, to: Weekday) => (from === to ? DAY_LABELS[from] : `${DAY_LABELS[from]}–${DAY_LABELS[to]}`)

/** Whether a typed or scanned code looks like a pickup code: six digits. */
export const isPickupCodeFormat = (code: string) => new RegExp(String.raw`^\d{${PICKUP_CODE_LENGTH}}$`).test(code)

/** An order's code, if issued, and when (ISO 8601) wrong codes were tried on it. */
export type PickupCodeState = { code: string | null; wrongAttempts: string[] }

export type PickupCodeCheck =
  | { ok: true }
  /** `wrongAttempts`: the order's wrong tries still counting, this one included, to keep. */
  | { ok: false; reason: "wrong_code"; wrongAttempts: string[] }
  /** Too many wrong codes lately: no code is checked until `retryAt` (ISO 8601). */
  | { ok: false; reason: "too_many_attempts"; retryAt: string }

/** Compares in time independent of where the codes differ. */
function sameCode(a: string, b: string) {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0)
  return diff === 0
}

/**
 * Checks a code entered at the counter against the order's. After `PICKUP_CODE_ATTEMPTS` wrong
 * codes within `PICKUP_CODE_WINDOW_MS`, every code is refused, the right one too, until the
 * oldest of them falls out of the window. A refused check isn't counted as a try.
 */
export function checkPickupCode({ code, wrongAttempts }: PickupCodeState, entered: string, now: Date): PickupCodeCheck {
  const since = now.getTime() - PICKUP_CODE_WINDOW_MS
  const recent = wrongAttempts.filter((at) => new Date(at).getTime() > since)
  if (recent.length >= PICKUP_CODE_ATTEMPTS) {
    const opensAt = new Date(recent[recent.length - PICKUP_CODE_ATTEMPTS]!).getTime() + PICKUP_CODE_WINDOW_MS
    return { ok: false, reason: "too_many_attempts", retryAt: new Date(opensAt).toISOString() }
  }
  if (code && sameCode(code, entered)) return { ok: true }
  return { ok: false, reason: "wrong_code", wrongAttempts: [...recent, now.toISOString()] }
}

/** "482 913": a pickup code in groups of three, as the buyer reads it out at the counter. */
export const pickupCodeGroups = (code: string) => code.replace(/(\d{3})(?=\d)/g, "$1 ")

/** "10am", "7:30pm", "12pm", "midnight" (24:00, a day's end): a local "HH:MM" as buyers read it. */
function clockLabel(time: string): string {
  const [hour, minute] = time.split(":").map(Number) as [number, number]
  if (hour === 24) return "midnight"
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  const minutes = minute ? `:${String(minute).padStart(2, "0")}` : ""
  return `${twelve}${minutes}${hour < 12 ? "am" : "pm"}`
}

/**
 * Today's hours on the pickup code, with any closure today applied (`todaysHours`):
 * "Open today 10am–6pm", "Closed today · Family event"; null for a shop without hours.
 */
export function todayHoursLabel(today: DayHours | null): string | null {
  if (!today) return null
  const { periods, closure } = today
  if (!periods.length) return closure?.note ? `Closed today · ${closure.note}` : "Closed today"
  if (periods.length === 1 && periods[0]!.opens === "00:00" && periods[0]!.closes === "24:00") return "Open 24 hours today"
  const ranges = periods.map((p) => `${clockLabel(p.opens)}–${clockLabel(p.closes)}`).join(", ")
  return `Open today ${ranges}`
}

/** What the counter is told when the code entered isn't the order's: nothing was handed over. */
export const PICKUP_WRONG_CODE_MESSAGE = "That code doesn't match this order. Check it with the buyer."

/**
 * "Too many wrong codes. Try again at 3:15pm.": the counter locked out after too many wrong
 * codes, with when it may try again (`retryAt`, ISO 8601, the API's `retry_at`) in the shop's
 * time, and the day when that isn't today ("at 12:10am Sat").
 */
export function pickupLockoutMessage(retryAt: string, now: Date, timeZone: string): string {
  return `Too many wrong codes. Try again at ${openingLabel(retryAt, now, timeZone)}.`
}

/**
 * Why the counter's Hand over order was refused (`POST /vendor/orders/:id/collect`): a wrong
 * code (400 `invalid_data`; the counter sends only a code of the right shape and a name, so the
 * API's own checks of those never answer it), too many lately (429 with `retry_at`), an order
 * that can't be handed over now (400 `not_allowed`: collected, not ready, or a delivery), or
 * none of these, a failure to retry.
 */
export type PickupRefusal = { kind: "wrong_code" } | { kind: "locked"; retryAt: string } | { kind: "not_allowed" } | { kind: "failed" }

export function pickupRefusal(status: number | undefined, body: unknown): PickupRefusal {
  const { type, retry_at: retryAt } = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  if (status === 429 && typeof retryAt === "string") return { kind: "locked", retryAt }
  if (status === 400 && type === "invalid_data") return { kind: "wrong_code" }
  if (status === 400 && type === "not_allowed") return { kind: "not_allowed" }
  return { kind: "failed" }
}
