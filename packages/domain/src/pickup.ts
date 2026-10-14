/**
 * In-store pickup (#12, docs/design.md → Pickup): the code a buyer collects with, how the
 * counter checks it, and what the buyer is told at checkout.
 */

import { WEEKDAYS, type OpenPeriod, type Weekday, type WeeklyHours } from "./shop-hours"

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
