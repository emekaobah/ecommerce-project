import { PriceListStatus, PriceListType } from "@medusajs/framework/utils"
import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { createPriceListPricesWorkflow, updatePriceListPricesWorkflow } from "@medusajs/medusa/core-flows"
import { createSellerPriceListsWorkflow } from "@mercurjs/core/workflows"
import { IMPORTED_SALE_LIST } from "../../lib/offer-import/sales"
import { findImportedSalePriceStep } from "./steps"

export type SetOfferSalePriceInput = {
  seller_id: string
  offer_id: string
  currency_code: string
  /** The sale price, in major units, below the offer's selling price. */
  amount: number
}

/**
 * Puts one of the shop's offers on sale from an import row (#46), in the shop's "Imported sale
 * prices" list, made the first time it's needed: the offer's price there is changed, or added.
 * Sales the shop made itself are left alone. The price carries the offer's `offer_id` rule, so
 * only this shop's offer is discounted, not other shops' offers of the same product (#10), and
 * the shop can change or end the sale in its price lists.
 */
export const setOfferSalePriceWorkflow = createWorkflow("set-offer-sale-price", (input: SetOfferSalePriceInput) => {
  const current = findImportedSalePriceStep(input)

  const made = when("make-imported-sale-list", current, (c) => !c.list_id).then(() =>
    createSellerPriceListsWorkflow.runAsStep({
      input: transform({ input }, ({ input }) => ({
        seller_id: input.seller_id,
        price_lists_data: [{ ...IMPORTED_SALE_LIST, type: PriceListType.SALE, status: PriceListStatus.ACTIVE }],
      })),
    })
  )

  const sale = transform({ input, current, made }, ({ input, current, made }) => ({
    list_id: current.list_id ?? made![0].id,
    price: {
      variant_id: current.variant_id,
      amount: input.amount,
      currency_code: input.currency_code,
      rules: { offer_id: input.offer_id },
    },
  }))

  when("change-sale-price", current, (c) => !!c.price).then(() => {
    updatePriceListPricesWorkflow.runAsStep({
      input: transform({ sale, current }, ({ sale, current }) => ({
        data: [{ id: sale.list_id, prices: [{ id: current.price!.id, ...sale.price }] }],
      })),
    })
  })

  when("add-sale-price", current, (c) => !c.price).then(() => {
    createPriceListPricesWorkflow.runAsStep({
      input: transform({ sale }, ({ sale }) => ({ data: [{ id: sale.list_id, prices: [sale.price] }] })),
    })
  })

  return new WorkflowResponse({ offer_id: input.offer_id })
})
