import type { IOrderModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN, MedusaError, Modules } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { orderMoney, paymentsOfOrder, type OrderRefundRecord, type Picks } from "../../../lib/order-fulfilment"
import { owedToBuyerOf, refundableShareOf, refundPlan, type OrderSummary } from "../../../lib/order-refund"
import type { RefundCovers } from "../../../modules/order-fulfilment/models/order-refund"
import { PaystackRequestError } from "../../../modules/paystack/client"
import { refundPayment, type RefundPaymentInput } from "./refund-payment"

type Scope = Parameters<typeof paymentsOfOrder>[0]

/**
 * Paystack refused one of a refund's payments, so none of that payment's money moved. The
 * refunds made before it stand (`made`), and `left` of what was asked is still unrefunded.
 */
export class RefundRefusedError extends MedusaError {
  constructor(
    readonly refusal: PaystackRequestError,
    readonly made: OrderRefundRecord[],
    readonly left: number
  ) {
    super(MedusaError.Types.UNEXPECTED_STATE, refusal.message)
  }
}

/** Refunds the payment on Paystack; one Paystack refuses is a `RefundRefusedError`. */
async function refundOrRefuse(container: Scope, input: RefundPaymentInput, made: OrderRefundRecord[], left: number) {
  try {
    return await refundPayment(container, input)
  } catch (error) {
    throw error instanceof PaystackRequestError ? new RefundRefusedError(error, made, left) : error
  }
}

export type RefundOrderShareInput = {
  order_id: string
  /**
   * What the refund is of (#22): the order's items, at most what was paid for them less their
   * earlier refunds; its delivery fee, which only Oja's staff refund, at most the fee less its
   * earlier refunds; or all of the order's share, for an order rejected.
   */
  covers: RefundCovers
  /**
   * The order lines it is for, and how many units of each (#61), recorded on each refund made;
   * none for a refund of no lines.
   */
  lines?: Picks | null
  /** All that is left of what it covers when left out. */
  amount?: number
  /** The shop or member that asked for it; none for the accept deadline. */
  created_by?: string
  note?: string
  refund_reason_id?: string
}

/**
 * Refunds the order's share of its payments (`refundPlan`) on Paystack and records each
 * refund against the order: a `refund` order transaction whose `reference_id` is Medusa's
 * refund, which the shop's order and payment views count (`lib/shop-order`), and an order
 * refund carrying Paystack's refund id and status. Money has moved once a refund is made, so
 * this step is never undone.
 *
 * Like Medusa's own refund, each refund also adds a credit line for what the order didn't
 * already owe the buyer, so the order's total no longer counts the refunded money as owed
 * (the web vendor panel shows total less net paid as outstanding). What the order owes is for
 * lines an order edit removed, so a refund of delivery never pays it off.
 *
 * A payment Paystack refuses throws a `RefundRefusedError`, with the refunds made before it.
 */
export async function refundOrderShare(
  container: Scope,
  { order_id, covers, lines, amount, created_by, note, refund_reason_id }: RefundOrderShareInput
): Promise<OrderRefundRecord[]> {
  const payments = await paymentsOfOrder(container, order_id)
  const money = await orderMoney(container, order_id, payments)
  const plan = refundPlan(money, covers === "all" ? amount : await withinWhatIsLeft(container, order_id, covers, amount))
  const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
  let owed = covers === "delivery" ? MathBN.convert(0) : MathBN.convert(await owedToBuyer(container, order_id))

  const recorded: OrderRefundRecord[] = []
  // One payment at a time: a refund Paystack turns down stops the rest, rather than racing them.
  for (const [i, part] of plan.entries()) {
    const left = MathBN.convert(plan.slice(i).reduce((sum, p) => MathBN.add(sum, p.amount), MathBN.convert(0))).toNumber()
    // Recording a refund Paystack made on the order may still fail: that is no refusal.
    const refunded = await refundOrRefuse(
      container,
      {
        ...part,
        currency_code: money.currency_code,
        order_id,
        covers,
        lines,
        earlier_refund_ids: payments.find((p) => p.id === part.payment_id)?.refunds?.map((r) => r.id) ?? [],
        created_by,
        note,
        refund_reason_id,
      },
      [...recorded],
      left
    )
    await orderModule.addOrderTransactions({
      order_id,
      amount: -part.amount,
      currency_code: money.currency_code,
      reference: "refund",
      reference_id: refunded.refund_id,
    })
    const credit = MathBN.max(MathBN.sub(part.amount, owed), 0)
    owed = MathBN.max(MathBN.sub(owed, part.amount), 0)
    if (MathBN.gt(credit, 0)) {
      await orderModule.createOrderCreditLines([
        { order_id, amount: credit, reference: "refund", reference_id: refunded.refund_id },
      ])
    }
    recorded.push(refunded.recorded)
  }
  return recorded
}

/** Refunds the order's share (`refundOrderShare`) as a workflow step. */
export const refundOrderShareStep = createStep("refund-order-share", async (input: RefundOrderShareInput, { container }) => {
  return new StepResponse(await refundOrderShare(container, input))
})

const WHAT_IS_LEFT: Record<Exclude<RefundCovers, "all">, string> = {
  items: "A refund of items can't be more than what was paid for them less what was refunded of them already",
  delivery: "A refund of delivery can't be more than the delivery fee less what was refunded of it already",
}

/**
 * How much of the order's items or delivery fee to refund: what was asked, or all that is left
 * when nothing was. Refused beyond what is left (`refundableShareOf`), or when nothing is.
 */
async function withinWhatIsLeft(container: Scope, orderId: string, covers: Exclude<RefundCovers, "all">, requested?: number) {
  const left = (await refundableShareOf(container, orderId))[covers]
  if (requested != null ? MathBN.gt(requested, left) : MathBN.lte(left, 0)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `${WHAT_IS_LEFT[covers]} (${left})`)
  }
  return requested ?? left
}

/** What the order already owes the buyer (`owedToBuyerOf`), which a refund of its items pays off first. */
async function owedToBuyer(container: Scope, orderId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["id", "summary"], filters: { id: orderId } })
  return owedToBuyerOf(data[0]?.summary as OrderSummary)
}
