import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderRefundRecord } from "../../../../../lib/order-fulfilment"
import type { OrderOwedRefund } from "../../../../../lib/owed-refunds"
import { retryOwedRefundNow } from "../../../../../lib/refund-retry"

export type AdminRetryOwedRefundResponse = {
  /** The refunds made; none when Paystack refused it again. */
  refunds: OrderRefundRecord[]
  /** What the order still owes its buyer; null once nothing. */
  owed_refund: OrderOwedRefund | null
}

/** Oja's staff retry the refund an order owes its buyer now, whatever its backoff (#16). `:id` is the order. */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse<AdminRetryOwedRefundResponse>) {
  const { refunds, owed } = await retryOwedRefundNow(req.scope, req.params.id, req.auth_context.actor_id)
  res.json({ refunds, owed_refund: owed })
}
