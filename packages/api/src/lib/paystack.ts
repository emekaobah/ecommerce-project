import { MedusaError } from "@medusajs/framework/utils"
import { paystackClient } from "../modules/paystack"
import { PaystackRequestError } from "../modules/paystack/client"

// Checking bank accounts at Paystack: a shop's payout account (#26), and a buyer's account for a
// refund that needs one (#13).

/** Paystack's API, refusing the request when Paystack isn't configured. */
export function requirePaystack() {
  const paystack = paystackClient()
  if (!paystack) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Bank accounts can't be checked yet: Paystack isn't set up")
  }
  return paystack
}

/** A bank Paystack sends money to: its code (to resolve accounts at), name, and id (to retry a refund to). */
export type PaystackBankChoice = { code: string; name: string; id: number }

/** Paystack's active banks in the currency, by name, each once. */
export async function activeBanks(currencyCode: string): Promise<PaystackBankChoice[]> {
  const banks = await requirePaystack().listBanks(currencyCode.toUpperCase())
  const byCode = new Map(banks.filter((b) => b.active).map((b) => [b.code, { code: b.code, name: b.name, id: b.id }]))
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Paystack refused the account, not our request: anything but our key being wrong or a rate limit. */
export const accountRefused = (error: unknown) =>
  error instanceof PaystackRequestError &&
  error.status >= 400 &&
  error.status < 500 &&
  ![401, 403, 429].includes(error.status)

/** Paystack is limiting bank lookups (test mode allows 3 a day): nothing is wrong with the account. */
export const lookupsLimited = (error: unknown) => error instanceof PaystackRequestError && error.status === 429
