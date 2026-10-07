import type { MedusaResponse } from "@medusajs/framework/http"
import { lookUpBarcode, type QuickAddLookup } from "../../../../lib/quick-add"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"

/** What a scanned barcode is to the shop: a product it sells, one the catalogue has, or one to propose. */
export async function GET(req: VendorRequest, res: MedusaResponse<{ lookup: QuickAddLookup }>) {
  res.json({ lookup: await lookUpBarcode(req.scope, sellerOf(req), req.params.barcode) })
}
