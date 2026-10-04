import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { createInventoryLevelsWorkflow, updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { updateOffersWorkflow } from "@mercurjs/core/workflows"
import { setOfferCostStep } from "./steps"

/** An offer price as Mercur's update-offers workflow takes the whole list: kept by id, changed or added. */
export type OfferPriceInput = {
  id?: string
  amount: number
  currency_code: string
  min_quantity?: number | null
  max_quantity?: number | null
  rules?: Record<string, string>
}

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
}

/**
 * A re-imported row's changes to an offer the shop already has (#37), all or
 * nothing: its selling price, its stock (an untracked offer starts being
 * tracked once a count is given) and its private cost price. A failing step
 * undoes the ones before it.
 */
export const updateImportedOfferWorkflow = createWorkflow("update-imported-offer", (input: UpdateImportedOfferInput) => {
  when("update-offer", input, (i) => i.prices !== null || i.stock !== null).then(() => {
    updateOffersWorkflow.runAsStep({
      input: transform({ input }, ({ input }) => ({
        offers: [
          {
            id: input.offer_id,
            ...(input.prices ? { prices: input.prices } : {}),
            ...(input.stock ? { manage_inventory: true } : {}),
          },
        ],
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

  return new WorkflowResponse({ id: input.offer_id })
})
