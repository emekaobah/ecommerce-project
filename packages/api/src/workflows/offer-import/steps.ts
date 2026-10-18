import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { enrichmentService, storedBySubmitter, type EnrichableField } from "../../lib/enrichment"
import { loadImportedSales } from "../../lib/offer-import/sales"
import { OFFER_IMPORT_MODULE, type OfferImportModuleService } from "../../modules/offer-import"

/**
 * Records a shop's proposal as queued for enrichment, as a vendor's (its data
 * isn't trusted). Images it already stored (a quick-add photo) are recorded as
 * stored, so enrichment keeps them rather than copying them again. The worker is told by the event the workflow emits once the
 * whole row has gone through; undone if a later step fails.
 */
export const recordQueuedEnrichmentStep = createStep(
  "record-queued-enrichment",
  async (input: { product_id: string; supplied: EnrichableField[]; stored_images?: string[] }, { container }) => {
    const record = await enrichmentService(container).createProductEnrichments({
      product_id: input.product_id,
      submitter: "vendor",
      supplied: { items: input.supplied },
      images: { items: (input.stored_images ?? []).map(storedBySubmitter) },
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

type SaleInput = { seller_id: string; offer_id: string; currency_code: string }

/** Where an offer's imported sale price goes: its price in the shop's imported sale list, or that list, if the shop has one. */
export const findImportedSalePriceStep = createStep("find-imported-sale-price", async (input: SaleInput, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data: [offer] }, sales] = await Promise.all([
    query.graph({ entity: "offer", fields: ["variant_id"], filters: { id: input.offer_id, seller_id: input.seller_id } }),
    loadImportedSales(container, input.seller_id, input.currency_code),
  ])
  if (!offer) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Offer ${input.offer_id} was not found.`)
  return new StepResponse({
    variant_id: offer.variant_id as string,
    list_id: sales.list_id,
    price: sales.by_offer.get(input.offer_id) ?? null,
  })
})
