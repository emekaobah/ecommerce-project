import type { MedusaResponse } from "@medusajs/framework/http"
import { pickListOf, type VendorPickListResponse } from "../../../../../lib/order-picking"
import { shopsOwnOrder, type VendorRequest } from "../../fulfilment"

/** The order's picking checklist: each line, how many to pick, its barcodes, and how many are picked. */
export const GET = async (req: VendorRequest, res: MedusaResponse<VendorPickListResponse>) => {
  const orderId = await shopsOwnOrder(req)
  res.json({ pick_list: await pickListOf(req.scope, orderId) })
}
