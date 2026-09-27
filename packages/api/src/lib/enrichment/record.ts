import type { MedusaContainer } from "@medusajs/framework/types"
import { PRODUCT_ENRICHMENT_MODULE } from "../../modules/product-enrichment"
import type ProductEnrichmentModuleService from "../../modules/product-enrichment/service"
import type { Attribution } from "./source"

// The enrichment record's vocabulary, as the product-enrichment module stores it.

/** Who supplied the product's own data: the operator reviewed it at import; a vendor did not. */
export type Submitter = "operator" | "vendor"
export type EnrichmentStatus = "queued" | "done" | "failed"
/** `published`: approved and complete; `needs_review`: sent to the proposal queue; `incomplete`: approved, still missing fields. */
export type EnrichmentOutcome = "published" | "needs_review" | "incomplete"

type Scope = Pick<MedusaContainer, "resolve">

export const enrichmentService = (scope: Scope) =>
  scope.resolve<ProductEnrichmentModuleService>(PRODUCT_ENRICHMENT_MODULE)

/** A product's enrichment record, or undefined when it wasn't enriched. */
export async function enrichmentOf(scope: Scope, productId: string) {
  const [record] = await enrichmentService(scope).listProductEnrichments({ product_id: productId })
  return record
}

/** The credits buyers must see for data the product took from product databases. */
export async function attributionOf(scope: Scope, productId: string): Promise<Attribution[]> {
  const record = await enrichmentOf(scope, productId)
  const items = (record?.attribution as { items?: Attribution[] } | undefined)?.items ?? []
  return items.map(({ name, url, license }) => ({ name, url, license }))
}
