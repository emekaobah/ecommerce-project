import { MedusaError } from "@medusajs/framework/utils"
import {
  PayoutAccountStatus,
  PayoutStatus,
  type CreateOnboardingInput,
  type CreateOnboardingResponse,
  type CreatePayoutAccountInput,
  type CreatePayoutAccountResponse,
  type CreatePayoutInput,
  type CreatePayoutResponse,
  type IPayoutProvider,
  type PayoutWebhookActionInput,
  type PayoutWebhookResult,
} from "@mercurjs/types"
import { PaystackClient, toSubunit, type PaystackTransferStatus } from "../paystack/client"

/** A Paystack account, which pays out in its country's currency. */
type PaystackAccount = { secretKey: string; apiUrl?: string }

export type PaystackPayoutOptions = {
  /** The Paystack account each currency is paid out from, by lowercase currency code (`ngn`). */
  accounts: Record<string, PaystackAccount>
}

/** What a payout passes the provider: where the money goes, and Paystack's reference for the transfer. */
export type PaystackPayoutData = {
  /** The shop's Paystack transfer recipient (`RCP_…`), from its bank account (#26). */
  recipient_code: string
  /** Ours, unique per payout, so Paystack never makes the same transfer twice. */
  reference: string
  /** Shown on the shop's bank statement. */
  reason: string
}

/**
 * How a transfer's status reads as a payout's. A transfer Paystack still holds is `pending`:
 * Mercur 2.3.5's payout table doesn't take `processing`, though its enum has it.
 */
export function payoutStatusOf(status: PaystackTransferStatus): PayoutStatus {
  if (status === "success") return PayoutStatus.PAID
  if (["failed", "reversed", "abandoned", "blocked", "rejected"].includes(status)) return PayoutStatus.FAILED
  return PayoutStatus.PENDING
}

/**
 * Pays shops with Paystack Transfers (#29), as Mercur's single payout provider.
 *
 * Shops onboard on Oja's Shop setup page, not with Paystack: their bank account is resolved and
 * made a transfer recipient there (#26), so a payout account is active from the start and holds
 * nothing. Each payout names the recipient it pays, read from the shop's bank account when it is
 * made, never from the payout account, which a member can create through Mercur's route.
 *
 * Paystack sends every webhook to the one URL an account has, the payment webhook's: its
 * `transfer.*` events are handled there (`src/subscribers/paystack-webhook.ts`), so Mercur's
 * `/hooks/payout` route gets nothing from Paystack.
 */
export class PaystackPayoutProviderService implements IPayoutProvider {
  static readonly identifier = "paystack"

  private readonly accounts: Map<string, PaystackClient>

  static validateOptions(options: PaystackPayoutOptions) {
    if (!Object.values(options.accounts ?? {}).some((a) => a.secretKey)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "The Paystack payout provider needs a Paystack secret key")
    }
  }

  constructor(_container: Record<string, unknown>, options: PaystackPayoutOptions) {
    this.accounts = new Map(
      Object.entries(options.accounts).map(([currency, a]) => [currency.toLowerCase(), new PaystackClient(a.secretKey, a.apiUrl)])
    )
  }

  createPayoutAccount({ context, data }: CreatePayoutAccountInput): Promise<CreatePayoutAccountResponse> {
    const id = context?.idempotency_key ?? String(data?.account_id ?? "")
    return Promise.resolve({ id, status: PayoutAccountStatus.ACTIVE, data: {} })
  }

  createOnboarding(_input: CreateOnboardingInput): Promise<CreateOnboardingResponse> {
    return Promise.resolve({ data: {} })
  }

  /**
   * Transfers the payout to the shop's recipient. Paystack queues it; `transfer.*` webhooks
   * settle it. A payout of nothing (everything taken back for refunds since earlier payouts)
   * sends nothing and is paid.
   */
  async createPayout({ amount, currency_code, data }: CreatePayoutInput): Promise<CreatePayoutResponse> {
    const { recipient_code, reference, reason } = (data ?? {}) as Partial<PaystackPayoutData>
    if (!recipient_code || !reference || !reason) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "A Paystack payout needs a recipient, a reference and a reason")
    }
    const subunits = toSubunit(amount)
    // Mercur keeps only what the provider returns: the payout's own data (its order) is passed on.
    if (subunits <= 0) return { status: PayoutStatus.PAID, data: { ...data, transfer_code: null } }
    const paystack = this.accounts.get(currency_code.toLowerCase())
    if (!paystack) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `No Paystack account pays out in ${currency_code.toUpperCase()}`)
    }
    const transfer = await paystack.transfer({
      amount: subunits,
      currency: currency_code.toUpperCase(),
      recipient: recipient_code,
      reference,
      reason,
    })
    return {
      status: payoutStatusOf(transfer.status),
      data: { ...data, transfer_code: transfer.transfer_code, transfer_status: transfer.status },
    }
  }

  /** Paystack's transfer webhooks arrive with its payment webhooks; see the class comment. */
  getWebhookActionAndData(_payload: PayoutWebhookActionInput): Promise<PayoutWebhookResult> {
    return Promise.resolve({ action: "not_supported" })
  }
}
