import type { MedusaResponse } from "@medusajs/framework/http"
import { pickListOf, type VendorPickListResponse } from "../../../../../../lib/order-picking"
import { recordPickWorkflow } from "../../../../../../workflows/order-fulfilment/workflows/record-pick"
import { shopsOwnOrder, type VendorRequest } from "../../../fulfilment"
import type { VendorRecordPickType } from "../../../validators"

/**
 * Staff set how many of a line they have picked (`picked`, by hand), or pick more of it (`add`,
 * by scanning): from none up to the quantity ordered. Only while the order is being picked.
 * Answers the updated checklist.
 */
export const POST = async (req: VendorRequest<VendorRecordPickType>, res: MedusaResponse<VendorPickListResponse>) => {
  const orderId = await shopsOwnOrder(req)
  await recordPickWorkflow(req.scope).run({
    input: { order_id: orderId, item_id: req.params.item_id, ...req.validatedBody },
  })
  res.json({ pick_list: await pickListOf(req.scope, orderId) })
}
