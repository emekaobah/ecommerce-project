import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { enrichmentService } from "../../../lib/enrichment"
import type { AdminListEnrichmentsType } from "./validators"

type ProductSummary = { id: string; title: string; status: string; thumbnail: string | null }

/**
 * Enrichment outcomes, newest first, with the product each belongs to: what was
 * auto-published (to spot-check), sent for review, or left incomplete.
 */
export async function GET(req: AuthenticatedMedusaRequest<unknown, AdminListEnrichmentsType>, res: MedusaResponse) {
  const { outcome, status, limit, offset } = req.validatedQuery
  const [records, count] = await enrichmentService(req.scope).listAndCountProductEnrichments(
    { ...(outcome ? { outcome } : {}), ...(status ? { status } : {}) },
    { order: { enriched_at: "DESC", created_at: "DESC" }, take: limit, skip: offset }
  )

  const productIds = records.map((r) => r.product_id)
  const { data } = productIds.length
    ? await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({
        entity: "product",
        fields: ["id", "title", "status", "thumbnail"],
        filters: { id: productIds },
      })
    : { data: [] }
  const products = new Map((data as ProductSummary[]).map((p) => [p.id, p]))

  res.json({
    enrichments: records.map((record) => ({ ...record, product: products.get(record.product_id) ?? null })),
    count,
    offset,
    limit,
  })
}
