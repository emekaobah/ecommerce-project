import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { InferTypeOf } from "@medusajs/framework/types"
import type RefundSettlement from "../../../../../modules/order-fulfilment/models/refund-settlement"
import { settleOwedRefundWorkflow } from "../../../../../workflows/order-fulfilment/workflows/refund-owed"
import type { AdminSettleOwedRefundType } from "./validators"

export type AdminSettleOwedRefundResponse = { settlement: InferTypeOf<typeof RefundSettlement> }

/**
 * Oja's staff mark the refund an order owes its buyer settled by hand (#16): sent by bank
 * transfer or another way, with a note. It is no longer retried. `:id` is the order.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<AdminSettleOwedRefundType>,
  res: MedusaResponse<AdminSettleOwedRefundResponse>
) {
  const { result } = await settleOwedRefundWorkflow(req.scope).run({
    input: { ...req.validatedBody, order_id: req.params.id, settled_by: req.auth_context.actor_id },
  })
  res.json({ settlement: result })
}
