import { AbstractPaymentProvider, MedusaError, PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  fromSubunit,
  isPaystackSignatureValid,
  PaystackClient,
  toSubunit,
  type PaystackTransaction,
} from "./client"

export type PaystackOptions = {
  /** `sk_test_…` or `sk_live_…`. Also verifies webhook signatures. */
  secretKey: string
  /** Paystack's API; overridden only to point tests at a fake. */
  apiUrl?: string
}

/** What checkout passes when it starts a payment session. */
type SessionInput = {
  session_id?: string
  email?: string
  /** Where Paystack sends the buyer after paying, or cancelling: the app's deep link. */
  callback_url?: string
}

/** Stored on the payment session: what was charged, to check Paystack's answer against. */
export type PaystackSessionData = {
  reference: string
  access_code: string
  authorization_url: string
  /** In the currency's subunit, as Paystack reports it. */
  amount: number
  currency: string
  transaction?: PaystackTransaction
}

/**
 * Paystack payments (docs/adr/0003-paystack-payments.md).
 *
 * Checkout starts a Paystack transaction and the buyer pays on Paystack's page. A transaction
 * counts as authorised only once Paystack's API says it succeeded for the amount started, and
 * the money counts as captured only when Paystack's signed `charge.success` webhook says so:
 * the webhook maps to `SUCCESSFUL`, which Mercur's payment webhook workflow captures and
 * completes the cart from. Nothing else captures: Paystack settles a charge by itself, so a
 * capture only records what the webhook confirmed.
 */
export class PaystackPaymentProviderService extends AbstractPaymentProvider<PaystackOptions> {
  static readonly identifier = "paystack"

  private readonly paystack: PaystackClient

  static validateOptions(options: PaystackOptions) {
    if (!options.secretKey) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "The Paystack payment provider needs PAYSTACK_SECRET_KEY")
    }
  }

  constructor(container: Record<string, unknown>, options: PaystackOptions) {
    super(container, options)
    this.paystack = new PaystackClient(options.secretKey, options.apiUrl)
  }

  async initiatePayment({ amount, currency_code, data, context }: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const { session_id, email = context?.customer?.email, callback_url } = (data ?? {}) as SessionInput
    if (!email) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Paystack needs the buyer's email to start a payment")
    }
    const charge = { amount: toSubunit(amount), currency: currency_code.toUpperCase() }
    const started = await this.paystack.initialize({
      ...charge,
      email,
      callback_url,
      // `cancel_action` sends a buyer who cancels on Paystack's page back to the app too.
      metadata: { session_id, ...(callback_url ? { cancel_action: callback_url } : {}) },
    })
    const session: PaystackSessionData = { ...started, ...charge }
    return { id: started.reference, status: PaymentSessionStatus.PENDING, data: session }
  }

  /** Paystack can't change a transaction's amount: a changed cart starts a new one. */
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const { status, data } = await this.initiatePayment(input)
    return { status, data }
  }

  /** Runs when the webhook's workflow completes the cart; the webhook alone isn't taken on trust. */
  async authorizePayment({ data }: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    return this.verified(data as PaystackSessionData)
  }

  async getPaymentStatus({ data }: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    return this.verified(data as PaystackSessionData)
  }

  async retrievePayment({ data }: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const session = data as PaystackSessionData
    return { data: { ...session, transaction: await this.paystack.verify(session.reference) } }
  }

  /** Paystack settles a successful charge by itself; the capture records the webhook's word. */
  async capturePayment({ data }: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data }
  }

  /**
   * Refunds part or all of the transaction. Paystack refunds asynchronously, so its reply is
   * only the refund it queued; the merchant note names Medusa's refund, to match it by.
   */
  async refundPayment({ data, amount, context }: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const session = data as PaystackSessionData
    const refund = await this.paystack.refund({
      transaction: session.reference,
      amount: toSubunit(amount),
      merchant_note: context?.idempotency_key,
    })
    return { data: { ...session, refund } }
  }

  /** An unpaid Paystack transaction simply lapses; there is nothing to void. */
  async cancelPayment({ data }: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data }
  }

  async deletePayment({ data }: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data }
  }

  async getWebhookActionAndData({ data, rawData, headers }: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    if (!isPaystackSignatureValid(this.config.secretKey, rawData, headers["x-paystack-signature"] as string | undefined)) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }
    const { event, data: transaction } = data as { event?: string; data?: PaystackTransaction }
    const sessionId = metadataOf(transaction)?.session_id
    if (event !== "charge.success" || transaction?.status !== "success" || typeof sessionId !== "string") {
      return { action: PaymentActions.NOT_SUPPORTED }
    }
    return { action: PaymentActions.SUCCESSFUL, data: { session_id: sessionId, amount: fromSubunit(transaction.amount) } }
  }

  /** Paystack's own word on the session's transaction. */
  private async verified(session: PaystackSessionData) {
    const transaction = await this.paystack.verify(session.reference)
    return { status: this.statusOf(session, transaction), data: { ...session, transaction } }
  }

  /**
   * Authorised only when Paystack took exactly what this session started, in its currency. A
   * refund turns the transaction `reversed` (even a partial one), but the buyer did pay it: a
   * reversed transaction still reads as paid, so a refund never makes a payment look failed.
   */
  private statusOf(session: PaystackSessionData, transaction: PaystackTransaction): PaymentSessionStatus {
    if (transaction.status === "failed") return PaymentSessionStatus.ERROR
    if (transaction.status !== "success" && transaction.status !== "reversed") return PaymentSessionStatus.PENDING
    const paidInFull = transaction.amount === session.amount && transaction.currency === session.currency
    return paidInFull ? PaymentSessionStatus.AUTHORIZED : PaymentSessionStatus.ERROR
  }
}

/** Paystack returns metadata as an object, or as the JSON string it was sent as. */
function metadataOf(transaction: PaystackTransaction | undefined): Record<string, unknown> | undefined {
  const metadata = transaction?.metadata
  if (typeof metadata !== "string") return metadata ?? undefined
  try {
    return JSON.parse(metadata)
  } catch {
    return undefined
  }
}
