import { createHmac, timingSafeEqual } from "node:crypto"
import { MathBN, MedusaError } from "@medusajs/framework/utils"
import type { BigNumberInput } from "@medusajs/framework/types"

export const PAYSTACK_API_URL = "https://api.paystack.co"

/** A Paystack transaction as initialise, verify and the `charge.*` webhooks describe it. */
export type PaystackTransaction = {
  id: number
  reference: string
  /** In the currency's subunit (kobo for NGN). */
  amount: number
  currency: string
  status: "success" | "failed" | "abandoned" | "ongoing" | "pending" | "processing" | "queued" | "reversed"
  metadata?: Record<string, unknown> | string | null
}

type Envelope<T> = { status: boolean; message: string; data: T }

/**
 * Paystack amounts are integers in the currency's subunit; every currency Paystack takes
 * (NGN, GHS, ZAR, KES, USD) has 100. Medusa amounts are decimal major units.
 */
export const toSubunit = (amount: BigNumberInput) => Math.round(MathBN.mult(amount, 100).toNumber())
export const fromSubunit = (amount: number) => MathBN.div(amount, 100).toNumber()

/**
 * Paystack signs each webhook with an HMAC-SHA512 of the raw body, keyed with the secret key,
 * in `x-paystack-signature`.
 */
export function isPaystackSignatureValid(
  secretKey: string,
  rawBody: Buffer | string,
  signature: string | string[] | undefined
): boolean {
  if (typeof signature !== "string") return false
  const expected = createHmac("sha512", secretKey).update(rawBody).digest()
  const received = Buffer.from(signature, "hex")
  return received.length === expected.length && timingSafeEqual(received, expected)
}

/** The few Paystack Transactions API calls checkout needs. */
export class PaystackClient {
  constructor(
    private readonly secretKey: string,
    private readonly apiUrl = PAYSTACK_API_URL
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.secretKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const envelope = (await res.json().catch(() => null)) as Envelope<T> | null
    if (!res.ok || !envelope?.status) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Paystack ${method} ${path} failed (${res.status}): ${envelope?.message ?? "no response"}`
      )
    }
    return envelope.data
  }

  initialize(input: {
    amount: number
    currency: string
    email: string
    callback_url?: string
    metadata: Record<string, unknown>
  }) {
    return this.request<{ authorization_url: string; access_code: string; reference: string }>(
      "POST",
      "/transaction/initialize",
      input
    )
  }

  verify(reference: string) {
    return this.request<PaystackTransaction>("GET", `/transaction/verify/${encodeURIComponent(reference)}`)
  }

  refund(input: { transaction: string; amount: number }) {
    return this.request<Record<string, unknown>>("POST", "/refund", input)
  }
}
