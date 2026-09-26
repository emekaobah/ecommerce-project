import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getProductCompleteness, type ProductCompleteness } from "../../../../../lib/product-completeness"

/** A product's completeness score and what it still needs before it can be published. */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ completeness: ProductCompleteness }>
) {
  const completeness = await getProductCompleteness(req.scope, req.params.id)
  res.json({ completeness })
}
