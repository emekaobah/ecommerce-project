import type { MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { refetchPayment, validateSellerPayment } from "@mercurjs/core/api/vendor/payments/helpers"
import { refundOrderShareWorkflow } from "../../../../../workflows/order-fulfilment/workflows/refund-order-share"
import type { VendorRequest } from "../../../orders/fulfilment"
import { shopOrderOfPayments } from "../../shop-view"

type VendorCreatePaymentRefund = { amount?: number; refund_reason_id?: string; note?: string }

/**
 * A shop refunds from the web vendor panel. In place of Mercur's route, which refunds the
 * whole checkout's payment: a shop refunds only its own order's share of it (#20), recorded
 * against its order. Mercur's middleware still validates the body and the fields.
 */
export const POST = async (req: VendorRequest<VendorCreatePaymentRefund>, res: MedusaResponse) => {
  const sellerId = req.seller_context?.seller_id ?? ""
  const paymentId = req.params.id
  await validateSellerPayment(req.scope, sellerId, paymentId)
  const orderId = (await shopOrderOfPayments(req, [paymentId])).get(paymentId)
  if (!orderId || orderId === paymentId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Payment with id: ${paymentId} was not found`)
  }
  await refundOrderShareWorkflow(req.scope).run({ input: { order_id: orderId, created_by: sellerId, ...req.validatedBody } })
  const payment = await refetchPayment(req.scope, paymentId, req.queryConfig.fields)
  res.status(200).json({ payment })
}
