import type { MedusaResponse } from "@medusajs/framework/http"
import { pickListOf, type VendorPickListResponse } from "../../../../../../../lib/order-picking"
import { markUnavailableWorkflow } from "../../../../../../../workflows/order-fulfilment/workflows/mark-unavailable"
import { shopsOwnOrder, type VendorRequest } from "../../../../fulfilment"
import type { VendorMarkUnavailableType } from "../../../../validators"

/**
 * Staff set how many of a line the shop doesn't have (#22), up to the units not yet picked:
 * the order is partially available until they are removed (`POST …/remove-unavailable`), or
 * back to picking when every mark is cleared. Answers the updated checklist, with what the
 * marked units would refund.
 */
export const POST = async (req: VendorRequest<VendorMarkUnavailableType>, res: MedusaResponse<VendorPickListResponse>) => {
  const orderId = await shopsOwnOrder(req)
  await markUnavailableWorkflow(req.scope).run({
    input: {
      order_id: orderId,
      item_id: req.params.item_id,
      quantity: req.validatedBody.quantity,
      actor: req.auth_context.actor_id,
    },
  })
  res.json({ pick_list: await pickListOf(req.scope, orderId) })
}
