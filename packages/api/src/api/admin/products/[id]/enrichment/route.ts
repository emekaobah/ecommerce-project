import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { enrichmentOf } from "../../../../../lib/enrichment"

/** What enrichment did to a product: where each field came from, and what it decided. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const enrichment = await enrichmentOf(req.scope, req.params.id)
  if (!enrichment) throw new MedusaError(MedusaError.Types.NOT_FOUND, "This product wasn't enriched.")
  res.json({ enrichment })
}
