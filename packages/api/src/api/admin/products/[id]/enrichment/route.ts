import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PRODUCT_ENRICHMENT_MODULE } from "../../../../../modules/product-enrichment"
import type ProductEnrichmentModuleService from "../../../../../modules/product-enrichment/service"

/** What enrichment did to a product: where each field came from, and what it decided. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const enrichments = req.scope.resolve<ProductEnrichmentModuleService>(PRODUCT_ENRICHMENT_MODULE)
  const [enrichment] = await enrichments.listProductEnrichments({ product_id: req.params.id })
  if (!enrichment) throw new MedusaError(MedusaError.Types.NOT_FOUND, "This product wasn't enriched.")
  res.json({ enrichment })
}
