import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { EnrichableField } from "./enrich"
import { enrichmentService, type Submitter } from "./record"

/** Emitted per queued product; the enrichment subscriber picks it up in the worker. */
export const ENRICHMENT_QUEUED = "product_enrichment.queued"

export type EnrichmentRequest = {
  product_id: string
  /** The fields the submitter filled in: they are never overwritten. */
  supplied: EnrichableField[]
}

type Scope = Pick<MedusaContainer, "resolve">

/** Records each product as queued, with the fields its submitter supplied, and hands it to the worker. */
export async function queueEnrichment(
  scope: Scope,
  requests: EnrichmentRequest[],
  submitter: Submitter
): Promise<void> {
  if (!requests.length) return
  await enrichmentService(scope).createProductEnrichments(
    requests.map((r) => ({
      product_id: r.product_id,
      submitter,
      supplied: { items: r.supplied },
    }))
  )
  await scope
    .resolve(Modules.EVENT_BUS)
    .emit(requests.map((r) => ({ name: ENRICHMENT_QUEUED, data: { id: r.product_id } })))
}
