import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils"
import { createOffersWorkflow, createProductsWorkflow } from "@mercurjs/core/workflows"
import { suppliedFields } from "../catalogue-import"
import { queueEnrichment } from "../enrichment"
import { errorMessage } from "../errors"
import { offerImportService, type ShopSetup } from "./load"
import type { ImportOffer, OfferImportRow, ProposedProduct } from "./rows"

export type OfferImportResult = {
  row: number
  title: string | null
  /**
   * `offered`: the shop now sells a catalogue product; `proposed`: a new product
   * went to review, offered by the shop; `skipped`: the row had errors;
   * `failed`: the catalogue refused it.
   */
  status: "offered" | "proposed" | "skipped" | "failed"
  offer_id: string | null
  product_id: string | null
  errors: string[]
  warnings: string[]
}

type ImportOptions = { seller_id: string; member_id: string; setup: ShopSetup }

/**
 * Imports each valid row, one at a time and independently. A matched row
 * becomes the shop's offer at once (offers on catalogue products need no
 * review). Any other row is proposed as a new product through Mercur's
 * create-products workflow, created by the shop as its own vendor proposals are,
 * queued for enrichment as a vendor's (so it goes to the admin queue unless a
 * trusted source vouches for it), and offered by the shop. The cost price is
 * kept apart from the offer, private to the shop's owner and managers.
 */
export async function importOfferRows(
  scope: MedusaContainer,
  rows: OfferImportRow[],
  options: ImportOptions
): Promise<OfferImportResult[]> {
  const results: OfferImportResult[] = []
  for (const row of rows) {
    const base = { row: row.row, title: row.title, errors: row.errors, warnings: [...row.warnings] }
    if (!row.offer) {
      results.push({ ...base, status: "skipped", offer_id: null, product_id: null })
      continue
    }
    let productId = row.offer.product_id
    try {
      let variantId = row.offer.variant_id
      if (row.proposal) {
        const proposed = await propose(scope, row.proposal, options)
        productId = proposed.product_id
        variantId = proposed.variant_id
      }
      const offerId = await createOffer(scope, row.offer, variantId!, options, base.warnings)
      results.push({ ...base, status: row.proposal ? "proposed" : "offered", offer_id: offerId, product_id: productId })
    } catch (error) {
      results.push({ ...base, status: "failed", offer_id: null, product_id: productId, errors: [errorMessage(error)] })
    }
  }
  return results
}

async function propose(scope: MedusaContainer, proposal: ProposedProduct, { seller_id, setup }: ImportOptions) {
  const { result } = await createProductsWorkflow(scope).run({
    input: {
      products: [
        {
          ...proposal,
          status: ProductStatus.PROPOSED,
          ...(setup.sales_channel_id && { sales_channels: [{ id: setup.sales_channel_id }] }),
        },
      ],
      // As Mercur's vendor product route does: the shop's own submission, listed among its products.
      created_by: seller_id,
    },
  })
  const productId = result[0].id
  await queueEnrichment(scope, [{ product_id: productId, supplied: suppliedFields(proposal) }], "vendor")
  const { data: [product] } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "product",
    fields: ["variants.id"],
    filters: { id: productId },
  })
  return { product_id: productId, variant_id: (product.variants as { id: string }[])[0].id }
}

async function createOffer(
  scope: MedusaContainer,
  offer: ImportOffer,
  variantId: string,
  { seller_id, member_id, setup }: ImportOptions,
  warnings: string[]
): Promise<string> {
  // Without a stock count the offer isn't tracked: it stays available, and a
  // pick that finds the shelf empty goes down the out-of-stock path.
  let tracked = offer.stock !== null
  if (tracked && !setup.stock_location_id) {
    warnings.push("Stock not recorded: the shop has no stock location yet.")
    tracked = false
  }
  const { result } = await createOffersWorkflow(scope).run({
    input: {
      offers: [
        {
          seller_id,
          created_by: member_id,
          sku: offer.sku,
          variant_id: variantId,
          shipping_profile_id: setup.shipping_profile_id!,
          manage_inventory: tracked,
          inventory_items: [
            { stock_levels: tracked ? [{ location_id: setup.stock_location_id!, stocked_quantity: offer.stock! }] : [] },
          ],
          prices: [{ amount: offer.price, currency_code: setup.currency_code }],
        },
      ],
    },
  })
  const offerId = result[0].id
  if (offer.cost !== null) {
    await offerImportService(scope).createOfferCosts({
      offer_id: offerId,
      seller_id,
      amount: offer.cost,
      currency_code: setup.currency_code,
    })
  }
  return offerId
}

export function summariseOfferImport(results: OfferImportResult[]) {
  const count = (status: OfferImportResult["status"]) => results.filter((r) => r.status === status).length
  return {
    total: results.length,
    offered: count("offered"),
    proposed: count("proposed"),
    skipped: count("skipped"),
    failed: count("failed"),
  }
}
