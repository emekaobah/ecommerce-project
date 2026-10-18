import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { createInventoryLevelsWorkflow, updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import type { OfferPriceInput } from "../offer-prices/steps"
import { updateOfferWorkflow } from "../offer-prices/update-offer"
import { putOnSaleIfGiven } from "./set-offer-sale-price"
import { setOfferCostStep } from "./steps"

export type UpdateImportedOfferInput = {
  offer_id: string
  seller_id: string
  currency_code: string
  /** The offer's whole price list with the new selling price in it; null leaves prices alone. */
  prices: OfferPriceInput[] | null
  /** The new stock count at the shop's stock location; null leaves stock alone. */
  stock: {
    inventory_item_id: string
    location_id: string
    stocked_quantity: number
    /** Whether the item already has a level at the location to update. */
    has_level: boolean
  } | null
  /** The new cost price; null leaves it alone. */
  cost: number | null
  /** The new sale price, kept to this offer (#46); null leaves any sale as it is. */
  sale: number | null
}

/**
 * A re-imported row's changes to an offer the shop already has (#37), all or
 * nothing: its selling price, its stock (an untracked offer starts being
 * tracked once a count is given), its private cost price and its sale price.
 * A failing step undoes the ones before it.
 */
export const updateImportedOfferWorkflow = createWorkflow("update-imported-offer", (input: UpdateImportedOfferInput) => {
  when("update-offer", input, (i) => i.prices !== null || i.stock !== null).then(() => {
    updateOfferWorkflow.runAsStep({
      input: transform({ input }, ({ input }) => ({
        offer: {
          id: input.offer_id,
          ...(input.prices ? { prices: input.prices } : {}),
          ...(input.stock ? { manage_inventory: true } : {}),
        },
      })),
    })
  })

  when("update-stock-level", input, (i) => !!i.stock?.has_level).then(() => {
    updateInventoryLevelsWorkflow.runAsStep({
      input: transform({ input }, ({ input }) => {
        const { inventory_item_id, location_id, stocked_quantity } = input.stock!
        return { updates: [{ inventory_item_id, location_id, stocked_quantity }] }
      }),
    })
  })

  when("create-stock-level", input, (i) => !!i.stock && !i.stock.has_level).then(() => {
    createInventoryLevelsWorkflow.runAsStep({
      input: transform({ input }, ({ input }) => {
        const { inventory_item_id, location_id, stocked_quantity } = input.stock!
        return { inventory_levels: [{ inventory_item_id, location_id, stocked_quantity }] }
      }),
    })
  })

  when("set-cost", input, (i) => i.cost !== null).then(() => {
    setOfferCostStep(
      transform({ input }, ({ input }) => ({
        offer_id: input.offer_id,
        seller_id: input.seller_id,
        amount: input.cost!,
        currency_code: input.currency_code,
      }))
    )
  })

  putOnSaleIfGiven(input)

  return new WorkflowResponse({ id: input.offer_id })
})
