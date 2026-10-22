import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { estimateDelivery, regionTimeZone, type DeliveryEstimate } from "../../../../../../lib/delivery"
import { retrieveListing } from "../../../../../../lib/listings"
import { customerIdOf } from "../../../delivering-to"
import type { StoreGetDeliveryEstimateParamsType } from "../../../validators"

export type StoreDeliveryEstimateResponse = { estimate: DeliveryEstimate | null }

/**
 * The product page's delivery estimate (#23): how the listing's shop would deliver one of the
 * variant the buyer picked to the saved address they are delivering to, by its best-value
 * Shipbubble rate. Null for a guest or a buyer without a saved address, whose page shows the
 * shop's dispatch time instead; not found for a variant the shop doesn't sell.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest<unknown, StoreGetDeliveryEstimateParamsType>,
  res: MedusaResponse<StoreDeliveryEstimateResponse>
) => {
  const customerId = customerIdOf(req)
  if (!customerId) {
    res.json({ estimate: null })
    return
  }
  const listing = await retrieveListing(req.scope, {
    regionId: req.validatedQuery.region_id,
    // Every store request carries its publishable key; none means no sales channel, so no listing.
    salesChannelIds: req.publishable_key_context?.sales_channel_ids ?? [],
    sellerId: req.params.seller_id,
    productId: req.params.product_id,
  })
  const { variant_id, address_id, region_id } = req.validatedQuery
  // The variant the buyer picked, else the headline offer: the shop's cheapest variant of it.
  const offer = variant_id
    ? listing.offers.find((o) => o.variant_id === variant_id)
    : [...listing.offers].sort((a, b) => a.calculated_price.calculated_amount - b.calculated_price.calculated_amount)[0]
  if (!offer) throw new MedusaError(MedusaError.Types.NOT_FOUND, "The shop doesn't sell that variant of the product")
  const estimate = await estimateDelivery(req.scope, {
    customerId,
    addressId: address_id,
    sellerId: listing.seller.id,
    line: {
      variant_id: offer.variant_id,
      title: listing.product.title,
      quantity: 1,
      unit_price: offer.calculated_price.calculated_amount,
    },
    currencyCode: offer.calculated_price.currency_code,
    perishable: listing.product.perishable,
    timeZone: await regionTimeZone(req.scope, region_id),
  })
  res.json({ estimate })
}
