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
/** A refund Paystack hasn't settled yet, either way. */
export const UNSETTLED_REFUND_STATUSES: PaystackRefundStatus[] = ["pending", "processing", "needs-attention"]

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

/** A refund as Paystack lists them (GET /refund): `transaction` is the transaction's id, or the transaction. */
export type PaystackListedRefund = PaystackRefund & { transaction?: number | { id: number; reference?: string } | null; createdAt?: string }

/**
 * Where a transfer is. Paystack queues a transfer (`pending`, or `otp` when the account asks
 * for an OTP on each transfer), then it ends `success`, `failed` or `reversed` (the bank
 * returned it).
 */
export type PaystackTransferStatus =
  | "pending"
  | "otp"
  | "received"
  | "success"
  | "failed"
  | "reversed"
  | "abandoned"
  | "blocked"
  | "rejected"

/** A transfer from our Paystack balance to a recipient (POST /transfer). */
export type PaystackTransfer = {
  id: number
  transfer_code: string
  /** Ours: one per payout, so Paystack never makes the same transfer twice. */
  reference: string
  /** In the currency's subunit. */
  amount: number
  currency: string
  status: PaystackTransferStatus
}

/** A bank Paystack can resolve accounts at and pay out to (GET /bank). */
export type PaystackBank = { name: string; code: string; currency: string; type: string; active: boolean }

/** A transfer recipient: who a payout is sent to (POST /transferrecipient). */
export type PaystackRecipient = {
  recipient_code: string
  name: string
  details: { account_number: string; account_name: string | null; bank_code: string; bank_name: string }
}

/**
 * A request Paystack refused; `status` is the HTTP status (422 when it can't resolve an
 * account), and `reason` Paystack's own message, such as "Insufficient balance".
 */
export class PaystackRequestError extends MedusaError {
  constructor(
    readonly status: number,
    message: string,
    readonly reason = message
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

/** The few Paystack Transactions, Refunds, Miscellaneous, Transfer Recipients and Transfers API calls we need. */
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
        `Paystack ${method} ${path} failed (${res.status}): ${envelope?.message ?? "no response"}`,
        envelope?.message ?? "No response"
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

  /**
   * Every refund made in the period, by anyone: through the API, or by hand in Paystack's
   * dashboard. `from` and `to` are ISO 8601.
   */
  async listRefunds(input: { from: string; to: string }): Promise<PaystackListedRefund[]> {
    const perPage = 100
    const refunds: PaystackListedRefund[] = []
    for (let page = 1; ; page++) {
      const params = new URLSearchParams({ ...input, perPage: String(perPage), page: String(page) })
      const batch = await this.request<PaystackListedRefund[]>("GET", `/refund?${params}`)
      refunds.push(...batch)
      if (batch.length < perPage) return refunds
    }
  }

  /** Sends money from our Paystack balance to a recipient; queued, then settled by `transfer.*` webhooks. */
  transfer(input: { amount: number; currency: string; recipient: string; reference: string; reason: string }) {
    return this.request<PaystackTransfer>("POST", "/transfer", { source: "balance", ...input })
  }

  verifyTransfer(reference: string) {
    return this.request<PaystackTransfer>("GET", `/transfer/verify/${encodeURIComponent(reference)}`)
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
