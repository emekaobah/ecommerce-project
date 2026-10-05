import { ProductStatus } from "@medusajs/framework/utils"
import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { emitEventStep, useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { createOffersWorkflow, createProductsWorkflow } from "@mercurjs/core/workflows"
import { ENRICHMENT_QUEUED, type EnrichableField } from "../../lib/enrichment"
import type { ProposedProduct } from "../../lib/offer-import/rows"
import { createOfferCostStep, recordQueuedEnrichmentStep } from "./steps"

export type CreateImportedOfferInput = {
  seller_id: string
  /** The member importing, who creates the offer. */
  member_id: string
  currency_code: string
  shipping_profile_id: string
  /** Where stock is counted; required when `stock` is given. */
  stock_location_id: string | null
  sales_channel_id: string | null
  /** A product to propose first, offered once it exists; null to offer `variant_id`. */
  proposal: ProposedProduct | null
  /** The proposal's fields the shop filled in, which enrichment never overwrites. */
  supplied: EnrichableField[]
  variant_id: string | null
  sku: string
  price: number
  cost: number | null
  /** Units in stock; null leaves the offer untracked. */
  stock: number | null
  /** Kept on the offer, e.g. how it was added (quick-add, #38). */
  metadata?: Record<string, unknown>
  /** The proposal's images already in our file storage, which enrichment keeps rather than copies again. */
  stored_images?: string[]
}

/**
 * One row of a shop's import, all or nothing (#37): proposes the product if the
 * catalogue lacks it (created by the shop, queued for enrichment as a vendor's),
 * creates the shop's offer on it, and keeps its cost price. A failing step undoes
 * those before it, so a failed row leaves no orphaned proposal, offer or cost,
 * and importing it again starts clean. The enrichment worker hears of the
 * proposal only once the row has gone through.
 */
export const createImportedOfferWorkflow = createWorkflow(
  "create-imported-offer",
  (input: CreateImportedOfferInput) => {
    const proposed = when("propose-product", input, (i) => !!i.proposal).then(() => {
      const products = createProductsWorkflow.runAsStep({
        input: transform({ input }, ({ input }) => ({
          products: [
            {
              ...input.proposal!,
              status: ProductStatus.PROPOSED,
              ...(input.sales_channel_id ? { sales_channels: [{ id: input.sales_channel_id }] } : {}),
            },
          ],
          // As Mercur's vendor product route does: the shop's own submission, listed among its products.
          created_by: input.seller_id,
        })),
      })
      const productId = transform({ products }, ({ products }) => products[0].id)
      const { data } = useQueryGraphStep({
        entity: "product",
        fields: ["id", "variants.id"],
        filters: { id: productId },
      }).config({ name: "load-proposed-variant" })
      recordQueuedEnrichmentStep(
        transform({ input, productId }, ({ input, productId }) => ({
          product_id: productId,
          supplied: input.supplied,
          stored_images: input.stored_images ?? [],
        }))
      )
      emitEventStep({ eventName: ENRICHMENT_QUEUED, data: transform({ productId }, ({ productId }) => ({ id: productId })) })
      return data
    })

    const offers = createOffersWorkflow.runAsStep({
      input: transform({ input, proposed }, ({ input, proposed }) => {
        const tracked = input.stock !== null
        const variantId = proposed ? (proposed[0] as { variants: { id: string }[] }).variants[0].id : input.variant_id!
        return {
          offers: [
            {
              seller_id: input.seller_id,
              created_by: input.member_id,
              sku: input.sku,
              variant_id: variantId,
              shipping_profile_id: input.shipping_profile_id,
              // Without a stock count the offer isn't tracked: it stays available, and a
              // pick that finds the shelf empty goes down the out-of-stock path.
              manage_inventory: tracked,
              inventory_items: [
                { stock_levels: tracked ? [{ location_id: input.stock_location_id!, stocked_quantity: input.stock! }] : [] },
              ],
              prices: [{ amount: input.price, currency_code: input.currency_code }],
              ...(input.metadata ? { metadata: input.metadata } : {}),
            },
          ],
        }
      }),
    })
    const offer = transform({ offers }, ({ offers }) => ({ id: offers[0].id, product_id: offers[0].product_id as string }))

    when("keep-cost", input, (i) => i.cost !== null).then(() => {
      createOfferCostStep(
        transform({ input, offer }, ({ input, offer }) => ({
          offer_id: offer.id,
          seller_id: input.seller_id,
          amount: input.cost!,
          currency_code: input.currency_code,
        }))
      )
    })

    return new WorkflowResponse(offer)
  }
)
