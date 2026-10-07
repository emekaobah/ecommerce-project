import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { createRemoteLinkStep } from "@medusajs/medusa/core-flows"
import type { AdditionalData } from "@medusajs/framework/types"
import type { UpdateOfferDTO } from "@mercurjs/types"
import { updateOffersWorkflow } from "@mercurjs/core/workflows"
import {
  getOfferPriceSetStep,
  offerPriceLink,
  removeDroppedOfferPricesStep,
  upsertOfferPricesStep,
  type OfferPriceInput,
} from "./steps"

export type UpdateOfferInput = { offer: Omit<UpdateOfferDTO, "prices"> & { prices?: OfferPriceInput[] } } & AdditionalData

/**
 * Updates one offer. Its fields go through Mercur's workflow, which runs Mercur's hooks
 * and emits `offer.updated`; its prices don't, because Mercur writes them as the variant's
 * whole shared price set and so deletes every other shop's price for it (#84). Instead
 * only the offer's own prices are written: the dropped ones removed, the rest changed or
 * added, the added ones linked. All or nothing.
 */
export const updateOfferWorkflow = createWorkflow("update-offer-own-prices", (input: UpdateOfferInput) => {
  const offers = updateOffersWorkflow.runAsStep({
    input: transform({ input }, ({ input }) => {
      const { prices: _prices, ...fields } = input.offer
      return { offers: [fields], additional_data: input.additional_data }
    }),
  })

  when("offer-prices-given", input, (i) => Array.isArray(i.offer.prices)).then(() => {
    const prices = transform({ input }, ({ input }) => ({ offer_id: input.offer.id, prices: input.offer.prices! }))
    const set = getOfferPriceSetStep(prices)
    removeDroppedOfferPricesStep(
      transform({ set, prices }, ({ set, prices }) => ({ set, keep: prices.prices.flatMap((p) => (p.id ? [p.id] : [])) }))
    )
    const created = upsertOfferPricesStep(transform({ set, prices }, ({ set, prices }) => ({ set, prices: prices.prices })))
    createRemoteLinkStep(
      transform({ set, created }, ({ set, created }) => created.map((id) => offerPriceLink(set.offer_id, id)))
    ).config({ name: "link-added-offer-prices" })
  })

  return new WorkflowResponse(transform({ offers }, ({ offers }) => offers[0]))
})
