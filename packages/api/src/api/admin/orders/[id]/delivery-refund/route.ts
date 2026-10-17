import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderRefundRecord } from "../../../../../lib/order-fulfilment"
import { deliveryRefundableOf, type DeliveryRefundable } from "../../../../../lib/order-refund"
import { refundOrderShareWorkflow } from "../../../../../workflows/order-fulfilment/workflows/refund-order-share"
import type { AdminRefundDeliveryType } from "./validators"

export type AdminDeliveryRefundableResponse = { delivery_refund: DeliveryRefundable }
export type AdminRefundDeliveryResponse = AdminDeliveryRefundableResponse & { refunds: OrderRefundRecord[] }

/** The order's delivery fee and how much of it is left to refund, for the admin's order page (#22). */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse<AdminDeliveryRefundableResponse>) {
  res.json({ delivery_refund: await deliveryRefundableOf(req.scope, req.params.id) })
}

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
  res.json({ refunds: result, delivery_refund: await deliveryRefundableOf(req.scope, req.params.id) })
}
