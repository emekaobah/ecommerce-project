import type { MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows"
import { normalizeOrderPaymentCollections, withCartPaymentCollectionFields } from "@mercurjs/core/api/vendor/orders/helpers"
import type { HttpTypes } from "@mercurjs/types"
import { ORDER_STAGES, type OrderStage } from "@oja/domain"
import { ordersInStage } from "../../../../lib/order-stages"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"
import type { VendorGetStageOrdersType } from "../validators"

/** The orders with the fields the request asks for, as Mercur's `/vendor/orders` reads them. */
async function ordersById(req: VendorRequest<unknown, VendorGetStageOrdersType>, ids: string[]) {
  const { result } = await getOrdersListWorkflow(req.scope).run({
    input: {
      fields: withCartPaymentCollectionFields(req.queryConfig.fields),
      variables: { filters: { id: ids, is_draft_order: false } },
    },
  })
  // Unpaged (the page is the ids), the workflow returns the orders themselves.
  return result as unknown as ({ id: string } & Record<string, unknown>)[]
}

const isStage = (stage: string): stage is OrderStage => (ORDER_STAGES as readonly string[]).includes(stage)

/**
 * The shop's orders in a stage (#69), newest first and paged, however old: what a stage tile
 * opens. Each order has the fields asked for, as on `/vendor/orders`, and its `fulfilment`.
 */
export const GET = async (
  req: VendorRequest<unknown, VendorGetStageOrdersType>,
  res: MedusaResponse<HttpTypes.VendorOrderListResponse>
) => {
  const { stage } = req.params
  if (!isStage(stage)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Stage must be one of ${ORDER_STAGES.join(", ")}`)
  }
  const { limit, offset } = req.validatedQuery
  const { order_ids, count } = await ordersInStage(req.scope, sellerOf(req), stage, { limit, offset })
  const rows = order_ids.length ? await ordersById(req, order_ids) : []
  rows.forEach((order) => normalizeOrderPaymentCollections(order as never))
  const byId = new Map(rows.map((o) => [o.id, o]))
  const orders = order_ids.flatMap((id) => byId.get(id) ?? [])
  res.json({ orders: orders as unknown as HttpTypes.VendorOrderListResponse["orders"], count, offset, limit })
}
