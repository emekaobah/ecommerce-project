import type { IOrderModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN, Modules } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { orderMoney, paymentsOfOrder, type OrderRefundRecord } from "../../../lib/order-fulfilment"
import { refundPlan } from "../../../lib/order-refund"
import { refundPayment } from "./refund-payment"

export type RefundOrderShareInput = {
  order_id: string
  /** All of the order's share still refundable when left out. */
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
 * (the web vendor panel shows total less net paid as outstanding).
 */
export const refundOrderShareStep = createStep(
  "refund-order-share",
  async ({ order_id, amount, created_by, note, refund_reason_id }: RefundOrderShareInput, { container }) => {
    const payments = await paymentsOfOrder(container, order_id)
    const money = await orderMoney(container, order_id, payments)
    const plan = refundPlan(money, amount)
    const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
    let owed = await owedToBuyer(container, order_id)

    const recorded: OrderRefundRecord[] = []
    // One payment at a time: a refund Paystack turns down stops the rest, rather than racing them.
    for (const part of plan) {
      const refunded = await refundPayment(container, {
        ...part,
        currency_code: money.currency_code,
        order_id,
        earlier_refund_ids: payments.find((p) => p.id === part.payment_id)?.refunds?.map((r) => r.id) ?? [],
        created_by,
        note,
        refund_reason_id,
      })
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
    return new StepResponse(recorded)
  }
)

/** What the order already owes the buyer (a negative pending difference), which a refund pays off first. */
async function owedToBuyer(container: Parameters<typeof paymentsOfOrder>[0], orderId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["id", "summary"], filters: { id: orderId } })
  const pending = (data[0]?.summary as { pending_difference?: number } | undefined)?.pending_difference ?? 0
  return MathBN.max(MathBN.mult(pending, -1), 0)
}
