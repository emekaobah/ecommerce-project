import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { fulfilmentService, paymentsOfOrder, type OrderRefundRecord, type Picks } from "../../../lib/order-fulfilment"
import {
  isDue,
  owedAttempts,
  owedLines,
  owedRefundOf,
  PAYSTACK_MIN_REFUND,
  paystackPart,
  type OrderOwedRefund,
} from "../../../lib/owed-refunds"
import type { SettlementMethod } from "../../../modules/order-fulfilment/models/refund-settlement"
import { UNSETTLED_REFUND_STATUSES } from "../../../modules/paystack/client"
import { refundOrderShare, RefundRefusedError } from "../steps/refund-order-share"
import type { PaymentData } from "../steps/refund-payment"
import { refundLockKeys } from "./refund-order-share"

type Scope = Pick<MedusaContainer, "resolve">

/** Who retries an owed refund: the retry job when it runs (ISO 8601), or Oja's staff. */
export type OwedRefundRetry = { by: "job"; at: string } | { by: "staff" }

export type RefundOwedInput = {
  order_id: string
  /** The member or operator that asked for it; none for the retry job. */
  created_by?: string
  note?: string
  /**
   * The order lines the edit or cancellation that owed the refund took off, and how many units
   * of each (#61). A retry names none: it is for the lines its earlier attempts were for.
   */
  lines?: Picks
  /**
   * Set when the refund is retried rather than tried after the edit that owed it. The retry job
   * tries it only once due (`isDue`); Oja's staff whatever its backoff. Neither tries it while
   * another refund of the order is still in Paystack's hands: the job leaves the order be, and
   * staff are refused, as they are for an order that owes nothing or under Paystack's minimum.
   */
  retry?: OwedRefundRetry
}

/** The refunds made, and what the order still owes its buyer afterwards (null once nothing). */
export type RefundOwedResult = { refunds: OrderRefundRecord[]; owed: OrderOwedRefund | null }

/**
 * Whether a refund of the order is still in Paystack's hands (`pending`, `processing` or
 * `needs-attention`), but one handed to Oja's team (#13): that is theirs to send, and what
 * else the order owes is still Paystack's to try.
 */
async function refundInProgress(scope: Scope, orderId: string) {
  const rows = await fulfilmentService(scope).listOrderRefunds(
    { order_id: orderId, status: UNSETTLED_REFUND_STATUSES, handed_over_at: null },
    { take: 1 }
  )
  return rows.length > 0
}

/** Refuses Oja's staff a retry of a refund the retry job couldn't try either. */
function refuseStaffRetry(orderId: string, owed: OrderOwedRefund | null, inProgress: boolean): void {
  if (!owed) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} owes its buyer no refund`)
  if (paystackPart(owed) <= 0) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      `Oja's team is sending order ${orderId}'s refund by hand: Paystack still holds it, so retry it from Paystack's dashboard`
    )
  }
  if (paystackPart(owed) < PAYSTACK_MIN_REFUND) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Paystack can't refund under ₦${PAYSTACK_MIN_REFUND}: send it by hand`)
  }
  if (inProgress) {
    throw new MedusaError(MedusaError.Types.CONFLICT, `A refund of order ${orderId} is still in Paystack's hands: retry once it settles`)
  }
}

/**
 * Tries to refund what the order owes its buyer: as a refund of items, or of all of a cancelled
 * order's share (#17). A payment Paystack refuses is recorded as a failed order refund of what
 * was left unrefunded, with Paystack's reason: an attempt (#16), and the order still owes it. Any other failure is no attempt: it
 * fails the step, and what Paystack made before it stands. Nothing is asked of Paystack under
 * its ₦50 minimum.
 */
const refundOwedStep = createStep("refund-owed", async (input: RefundOwedInput, { container }) => {
  const { order_id: orderId, retry } = input
  const owed = await owedRefundOf(container, orderId)
  const unchanged = (): StepResponse<RefundOwedResult> => new StepResponse({ refunds: [], owed })
  const inProgress = !!retry && (await refundInProgress(container, orderId))
  if (retry?.by === "staff") refuseStaffRetry(orderId, owed, inProgress)
  if (!owed || paystackPart(owed) < PAYSTACK_MIN_REFUND || inProgress) return unchanged()
  if (retry?.by === "job" && !isDue(owed, new Date(retry.at))) return unchanged()

  const lines = await linesOwed(container, orderId, input.lines)
  try {
    const refunds = await refundOrderShare(container, {
      order_id: orderId,
      covers: owed.covers,
      lines,
      amount: paystackPart(owed),
      created_by: input.created_by,
      note: input.note,
    })
    return new StepResponse({ refunds, owed: await owedRefundOf(container, orderId) })
  } catch (error) {
    if (!(error instanceof RefundRefusedError)) throw error
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .warn(`Paystack refused the refund of ${error.left} owed on order ${orderId}: ${error.refusal.reason}`)
    // A refund made before it already names the lines: one refund to the buyer names them once.
    await recordRefusal(container, owed, error.made.length ? null : lines, error.left, error.refusal.reason)
    return new StepResponse({ refunds: error.made, owed: await owedRefundOf(container, orderId) })
  }
})

/** The order lines what the order owes is for (`owedLines`): its earlier attempts', and those just `added`. */
async function linesOwed(scope: Scope, orderId: string, added?: Picks): Promise<Picks | null> {
  const [refunds, settlements] = await Promise.all([
    fulfilmentService(scope).listOrderRefunds({ order_id: orderId }),
    fulfilmentService(scope).listRefundSettlements({ order_id: orderId }),
  ])
  return owedLines(owedAttempts({ refunds, settlements }), added)
}

/** Records a refund Paystack refused: a failed order refund of what was owed with its reason, which no Medusa refund backs. */
async function recordRefusal(scope: Scope, owed: OrderOwedRefund, lines: Picks | null, amount: number, reason: string) {
  const [payment] = await paymentsOfOrder(scope, owed.order_id)
  await fulfilmentService(scope).createOrderRefunds({
    order_id: owed.order_id,
    payment_id: payment?.id ?? null,
    amount,
    covers: owed.covers,
    lines,
    currency_code: owed.currency_code,
    transaction_reference: (payment?.data as PaymentData | undefined)?.reference ?? "",
    status: "failed",
    failure_reason: reason,
  })
}

export type SettleOwedRefundInput = {
  order_id: string
  method: SettlementMethod
  note: string
  /** The operator that settled it. */
  settled_by: string
}

/** Records that Oja's team settled all the order still owes its buyer by hand. Refused when it owes nothing. */
const settleOwedRefundStep = createStep("settle-owed-refund", async (input: SettleOwedRefundInput, { container }) => {
  const owed = await owedRefundOf(container, input.order_id)
  if (!owed) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${input.order_id} owes its buyer no refund`)
  const settlement = await fulfilmentService(container).createRefundSettlements({
    ...input,
    amount: owed.amount,
    currency_code: owed.currency_code,
  })
  return new StepResponse(settlement, settlement.id)
}, async (id, { container }) => {
  if (id) await fulfilmentService(container).deleteRefundSettlements(id)
})

/**
 * Oja's staff mark what an order owes its buyer settled by hand (#16), by bank transfer say,
 * holding the order's refund lock so no retry races it. It is no longer retried, and still
 * comes off the shop's payout: the order summary still owes it.
 */
export const settleOwedRefundWorkflow = createWorkflow("settle-owed-refund", (input: SettleOwedRefundInput) => {
  const keys = refundLockKeys(input)
  acquireLockStep({ key: keys, timeout: 10, ttl: 60 })
  const settlement = settleOwedRefundStep(input)
  releaseLockStep({ key: keys })
  return new WorkflowResponse(settlement)
})

/**
 * Refunds what an order owes its buyer (#16), holding the order's refund lock: after an order
 * edit, by the retry job, or when an operator retries it. See `refundOwedStep`.
 */
export const refundOwedWorkflow = createWorkflow("refund-owed", (input: RefundOwedInput) => {
  const keys = refundLockKeys(input)
  acquireLockStep({ key: keys, timeout: 10, ttl: 60 })
  const result = refundOwedStep(input)
  releaseLockStep({ key: keys })
  return new WorkflowResponse(result)
})
