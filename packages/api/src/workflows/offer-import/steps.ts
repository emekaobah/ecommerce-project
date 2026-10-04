import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { enrichmentService, type EnrichableField } from "../../lib/enrichment"
import { OFFER_IMPORT_MODULE, type OfferImportModuleService } from "../../modules/offer-import"

/**
 * Records a shop's proposal as queued for enrichment, as a vendor's (its data
 * isn't trusted). The worker is told by the event the workflow emits once the
 * whole row has gone through; undone if a later step fails.
 */
export const recordQueuedEnrichmentStep = createStep(
  "record-queued-enrichment",
  async (input: { product_id: string; supplied: EnrichableField[] }, { container }) => {
    const record = await enrichmentService(container).createProductEnrichments({
      product_id: input.product_id,
      submitter: "vendor",
      supplied: { items: input.supplied },
    })
    return new StepResponse(record, record.id)
  },
  async (id, { container }) => {
    if (id) await enrichmentService(container).deleteProductEnrichments(id)
  }
)

/** Keeps the shop's private cost price for a new offer; undone if a later step fails. */
export const createOfferCostStep = createStep(
  "create-offer-cost",
  async (input: { offer_id: string; seller_id: string; amount: number; currency_code: string }, { container }) => {
    const cost = await container.resolve<OfferImportModuleService>(OFFER_IMPORT_MODULE).createOfferCosts(input)
    return new StepResponse(cost, cost.id)
  },
  async (id, { container }) => {
    if (id) await container.resolve<OfferImportModuleService>(OFFER_IMPORT_MODULE).deleteOfferCosts(id)
  }
)
