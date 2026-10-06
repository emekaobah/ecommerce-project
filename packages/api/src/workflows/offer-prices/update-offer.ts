import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import type { AdditionalData } from "@medusajs/framework/types"
import type { UpdateOfferDTO } from "@mercurjs/types"
import { updateOffersWorkflow } from "@mercurjs/core/workflows"
import { setOfferPricesStep, type OfferPriceInput } from "./steps"

export type UpdateOfferInput = { offer: Omit<UpdateOfferDTO, "prices"> & { prices?: OfferPriceInput[] } } & AdditionalData

/**
 * Updates one offer: its prices through `setOfferPricesStep`, which leaves other shops'
 * prices for the variant alone (#84), and its other fields through Mercur's workflow,
 * which also runs Mercur's hooks and emits `offer.updated`. All or nothing.
 */
export const updateOfferWorkflow = createWorkflow("update-offer-own-prices", (input: UpdateOfferInput) => {
  when("set-offer-prices", input, (i) => Array.isArray(i.offer.prices)).then(() => {
    setOfferPricesStep(transform({ input }, ({ input }) => ({ offer_id: input.offer.id, prices: input.offer.prices! })))
  })

  const offers = updateOffersWorkflow.runAsStep({
    input: transform({ input }, ({ input }) => {
      const { prices: _prices, ...fields } = input.offer
      return { offers: [fields], additional_data: input.additional_data }
    }),
  })

  return new WorkflowResponse(transform({ offers }, ({ offers }) => offers[0]))
})
