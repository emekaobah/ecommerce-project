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
  status:
    | "success"
    | "failed"
    | "abandoned"
    | "ongoing"
    | "pending"
    | "processing"
    | "queued"
    | "reversal-pending"
    | "reversed"
  metadata?: Record<string, unknown> | string | null
}

/** Where a refund is: Paystack refunds asynchronously, and a refund can fail after it was started. */
export const PAYSTACK_REFUND_STATUSES = ["pending", "processing", "processed", "failed", "needs-attention"] as const
export type PaystackRefundStatus = (typeof PAYSTACK_REFUND_STATUSES)[number]

/** A refund as Paystack's Refunds API describes it. */
export type PaystackRefund = {
  id: number
  status: PaystackRefundStatus
  /** In the currency's subunit. */
  amount: number
  currency: string
  merchant_note?: string | null
}

type Envelope<T> = { status: boolean; message: string; data: T }

/** A bank Paystack can resolve accounts at and pay out to (GET /bank). */
export type PaystackBank = { name: string; code: string; currency: string; type: string; active: boolean }

/** A transfer recipient: who a payout is sent to (POST /transferrecipient). */
export type PaystackRecipient = {
  recipient_code: string
  name: string
  details: { account_number: string; account_name: string | null; bank_code: string; bank_name: string }
}

/** A request Paystack refused; `status` is the HTTP status (422 when it can't resolve an account). */
export class PaystackRequestError extends MedusaError {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(MedusaError.Types.UNEXPECTED_STATE, message)
  }
}

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

/** The few Paystack Transactions, Refunds, Miscellaneous and Transfer Recipients API calls we need. */
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
      throw new PaystackRequestError(
        res.status,
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

  /** Refunds part of a transaction, or all of it with no amount; `merchant_note` is ours, for matching it later. */
  refund(input: { transaction: string; amount?: number; merchant_note?: string }) {
    return this.request<PaystackRefund>("POST", "/refund", input)
  }

  fetchRefund(id: number | string) {
    return this.request<PaystackRefund>("GET", `/refund/${encodeURIComponent(String(id))}`)
  }

  /** Banks in a currency that accounts can be resolved at (NUBAN banks for NGN). */
  listBanks(currency: string) {
    return this.request<PaystackBank[]>("GET", `/bank?${new URLSearchParams({ currency, perPage: "100" })}`)
  }

  /** The holder's name of an account at a bank; refused (422) when the bank has no such account. */
  resolveAccount(input: { account_number: string; bank_code: string }) {
    return this.request<{ account_number: string; account_name: string }>(
      "GET",
      `/bank/resolve?${new URLSearchParams(input)}`
    )
  }

  /** Registers a bank account as somewhere transfers can be sent. */
  createTransferRecipient(input: { type: "nuban"; name: string; account_number: string; bank_code: string; currency: string }) {
    return this.request<PaystackRecipient>("POST", "/transferrecipient", input)
  }
}
