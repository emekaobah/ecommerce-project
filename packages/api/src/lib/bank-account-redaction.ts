// A bank account number goes to Paystack only (#13): it is never logged or sent to Sentry.
// Sentry attaches incoming request bodies to its events by default and records outgoing
// requests' URLs, which for Paystack's account lookup carry the number in the query.

/** The API's requests whose body carries a bank account number: a buyer's refund account (#13), a shop's payout account (#26). */
const BANK_ACCOUNT_PATHS = [/\/store\/refunds\/[^/]+\/(resolve-account|retry)$/, /\/vendor\/onboarding\/bank-account$/]

/** Whether a request to `url` carries a bank account number in its body. */
export function carriesBankAccount(url: string): boolean {
  const path = url.split("?")[0]!
  return BANK_ACCOUNT_PATHS.some((p) => p.test(path))
}

const IN_TEXT = /(account_number"?\s*[=:]\s*"?)\d+/g

const isPlain = (value: object) => {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * The value with every account number in its strings, as a query parameter or JSON field,
 * blanked: through plain objects and arrays (a Sentry event), anything else left as it is.
 */
export function redactAccountNumbers<T>(value: T, seen = new Map<object, unknown>()): T {
  if (typeof value === "string") return value.replace(IN_TEXT, "$1[redacted]") as T
  if (!value || typeof value !== "object") return value
  if (seen.has(value)) return seen.get(value) as T
  if (Array.isArray(value)) {
    const copy: unknown[] = []
    seen.set(value, copy)
    for (const item of value) copy.push(redactAccountNumbers(item, seen))
    return copy as T
  }
  if (!isPlain(value)) return value
  const copy: Record<string, unknown> = {}
  seen.set(value, copy)
  for (const [k, v] of Object.entries(value)) copy[k] = redactAccountNumbers(v, seen)
  return copy as T
}
