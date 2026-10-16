import type { IPaymentModuleService, MedusaContainer } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { fulfilmentService, type OrderRefundRecord } from "../../../lib/order-fulfilment"
import type { RefundCovers } from "../../../modules/order-fulfilment/models/order-refund"
import type { PaystackRefund } from "../../../modules/paystack/client"

type PaymentData = { reference?: string; refund?: PaystackRefund }

export type RefundPaymentInput = {
  payment_id: string
  amount: number
  currency_code: string
  /** The order refunded; none for a payment no order claims. */
  order_id: string | null
  /** What the refund is of: items unless said otherwise. */
  covers?: RefundCovers
  /** Medusa's refunds of the payment before this one, to tell the new one apart. */
  earlier_refund_ids: string[]
  created_by?: string
  note?: string
  refund_reason_id?: string
}

/**
 * Refunds an amount of a payment on Paystack through Medusa's payment module, and records it
 * as an order refund with Paystack's refund id and status. Returns Medusa's refund id too.
 */
export async function refundPayment(
  container: Pick<MedusaContainer, "resolve">,
  input: RefundPaymentInput
): Promise<{ refund_id: string; recorded: OrderRefundRecord }> {
  const { payment_id, amount, currency_code, order_id, covers = "items", earlier_refund_ids, created_by, note, refund_reason_id } =
    input
  const earlier = new Set(earlier_refund_ids)
  const payment = await container
    .resolve<IPaymentModuleService>(Modules.PAYMENT)
    .refundPayment({ payment_id, amount, created_by, note, refund_reason_id })
  const refund = payment.refunds?.find((r) => !earlier.has(r.id))
  if (!refund) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Refund of payment ${payment_id} was not recorded`)
  // The provider keeps Paystack's reply to the latest refund; its note names Medusa's refund.
  const data = (payment.data ?? {}) as PaymentData
  const paystack = data.refund?.merchant_note === refund.id ? data.refund : undefined
  const recorded = await fulfilmentService(container).createOrderRefunds({
    order_id,
    payment_id,
    refund_id: refund.id,
    amount,
    covers,
    currency_code,
    transaction_reference: data.reference ?? "",
    paystack_refund_id: paystack ? String(paystack.id) : null,
    status: paystack?.status ?? "pending",
  })
  return { refund_id: refund.id, recorded }
}
