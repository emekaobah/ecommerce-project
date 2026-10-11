/**
 * In-store pickup (#12, docs/design.md → Pickup): the code a buyer collects with, how the
 * counter checks it, and what the buyer is told at checkout.
 */

/** A pickup code is this many digits, shown in the buyer's order and as a QR code of them. */
export const PICKUP_CODE_LENGTH = 6
/** How many wrong codes an order takes within `PICKUP_CODE_WINDOW_MS` before it refuses any code. */
export const PICKUP_CODE_ATTEMPTS = 5
export const PICKUP_CODE_WINDOW_MS = 15 * 60 * 1000

/** What the buyer is told before choosing pickup, and on the order. */
export const PICKUP_HOLD_NOTICE = "Collect within 5 open days; fresh items aren't refunded if not collected."
/** Why a shop with fresh items switched to pickup at checkout (`perishable_too_slow`, #69). */
export const PERISHABLE_PICKUP_NOTE = "No courier can get fresh items to you in time — collect in store"

/** Whether a typed or scanned code looks like a pickup code: six digits. */
export const isPickupCodeFormat = (code: string) => new RegExp(`^\\d{${PICKUP_CODE_LENGTH}}$`).test(code)

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
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
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
