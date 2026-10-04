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

type OfferCostInput = { offer_id: string; seller_id: string; amount: number; currency_code: string }
type CostUndo = { created: string } | { id: string; amount: number; currency_code: string }

/** Sets an existing offer's private cost price, keeping the old one to restore if a later step fails. */
export const setOfferCostStep = createStep(
  "set-offer-cost",
  async (input: OfferCostInput, { container }) => {
    const service = container.resolve<OfferImportModuleService>(OFFER_IMPORT_MODULE)
    const [current] = await service.listOfferCosts({ offer_id: input.offer_id, seller_id: input.seller_id })
    if (!current) {
      const cost = await service.createOfferCosts(input)
      return new StepResponse<unknown, CostUndo>(cost, { created: cost.id })
    }
    const cost = await service.updateOfferCosts({ id: current.id, amount: input.amount, currency_code: input.currency_code })
    return new StepResponse<unknown, CostUndo>(cost, {
      id: current.id,
      amount: Number(current.amount),
      currency_code: current.currency_code,
    })
  },
  async (undo, { container }) => {
    if (!undo) return
    const service = container.resolve<OfferImportModuleService>(OFFER_IMPORT_MODULE)
    if ("created" in undo) await service.deleteOfferCosts(undo.created)
    else await service.updateOfferCosts(undo)
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
