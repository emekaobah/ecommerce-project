import type { IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
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
 */
export const refundOrderShareStep = createStep(
  "refund-order-share",
  async ({ order_id, amount, created_by, note, refund_reason_id }: RefundOrderShareInput, { container }) => {
    const payments = await paymentsOfOrder(container, order_id)
    const money = await orderMoney(container, order_id, payments)
    const plan = refundPlan(money, amount)
    const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)

    const recorded: OrderRefundRecord[] = []
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
      recorded.push(refunded.recorded)
    }
    return new StepResponse(recorded)
  }
)
