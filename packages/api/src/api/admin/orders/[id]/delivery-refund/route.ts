import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderRefundRecord } from "../../../../../lib/order-fulfilment"
import { refundOrderShareWorkflow } from "../../../../../workflows/order-fulfilment/workflows/refund-order-share"
import type { AdminRefundDeliveryType } from "./validators"

export type AdminRefundDeliveryResponse = { refunds: OrderRefundRecord[] }

/**
 * Oja's staff refund an order's delivery fee (#22), a late courier say. Oja keeps the fee, so
 * the refund comes out of Oja's share and never off the shop's payout. Shops refund only items.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<AdminRefundDeliveryType>,
  res: MedusaResponse<AdminRefundDeliveryResponse>
) {
  const { result } = await refundOrderShareWorkflow(req.scope).run({
    input: { ...req.validatedBody, order_id: req.params.id, covers: "delivery", created_by: req.auth_context.actor_id },
  })
  res.json({ refunds: result })
}
