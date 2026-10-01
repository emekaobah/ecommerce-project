import type { IOrderModuleService, IPaymentModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { fulfilmentService, orderMoney, paymentsOfOrder, type OrderRefundRecord } from "../../../lib/order-fulfilment"
import { refundPlan } from "../../../lib/order-refund"
import type { PaystackRefund } from "../../../modules/paystack/client"

export type RefundOrderShareInput = {
  order_id: string
  /** All of the order's share still refundable when left out. */
  amount?: number
  /** The shop or member that asked for it; none for the accept deadline. */
  created_by?: string
  note?: string
  refund_reason_id?: string
}

type PaymentData = { reference?: string; refund?: PaystackRefund }

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
    const paymentModule = container.resolve<IPaymentModuleService>(Modules.PAYMENT)
    const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)

    const recorded: OrderRefundRecord[] = []
    for (const part of plan) {
      const earlier = new Set(payments.find((p) => p.id === part.payment_id)?.refunds?.map((r) => r.id))
      const payment = await paymentModule.refundPayment({
        payment_id: part.payment_id,
        amount: part.amount,
        created_by,
        note,
        refund_reason_id,
      })
      const refund = payment.refunds?.find((r) => !earlier.has(r.id))
      if (!refund) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Refund of payment ${part.payment_id} was not recorded`)
      }
      await orderModule.addOrderTransactions({
        order_id,
        amount: -part.amount,
        currency_code: money.currency_code,
        reference: "refund",
        reference_id: refund.id,
      })
      // The provider keeps Paystack's reply to the latest refund; its note names Medusa's refund.
      const data = (payment.data ?? {}) as PaymentData
      const paystack = data.refund?.merchant_note === refund.id ? data.refund : undefined
      recorded.push(
        await fulfilmentService(container).createOrderRefunds({
          order_id,
          payment_id: part.payment_id,
          refund_id: refund.id,
          amount: part.amount,
          currency_code: money.currency_code,
          transaction_reference: data.reference ?? "",
          paystack_refund_id: paystack ? String(paystack.id) : null,
          status: paystack?.status ?? "pending",
        })
      )
    }
    return new StepResponse(recorded)
  }
)
