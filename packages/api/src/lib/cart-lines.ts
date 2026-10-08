import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { addToCartWorkflow } from "@medusajs/medusa/core-flows"
import { priceOffers } from "./listings"
import { isLive } from "./onboarding"
import { refuseClosedShops } from "./shop-hours"

// Cart lines are priced from their own offer and pinned there.
//
// Medusa prices cart lines per variant, and Mercur's cart pricing hooks put every offer in the
// cart into one pricing context, so when two shops sell the same variant a quantity change,
// sign-in (cart transfer) or address change reprices both lines at the cheaper shop's price.
// Lines therefore carry their offer's price as a custom price, which those refreshes keep.
// A shop's later price change reaches the line when its quantity next changes; checkout
// must reprice before payment (docs/design.md).

/** What a line is charged: its offer's price in the cart's region. */
export type OfferLinePrice = {
  offer_id: string
  seller_id: string
  variant_id: string
  unit_price: number
  compare_at_unit_price: number | null
  is_tax_inclusive: boolean
}

type CartPricing = { id: string; region_id: string | null; currency_code: string; customer_id: string | null }

/** Mercur links each line item to its offer and also stamps `offer_id` in its metadata. */
export function offerIdOf(item: {
  offer?: { id: string } | null
  metadata?: Record<string, unknown> | null
}): string | null {
  if (item.offer?.id) return item.offer.id
  const fromMetadata = item.metadata?.offer_id
  return typeof fromMetadata === "string" && fromMetadata.length ? fromMetadata : null
}

async function loadCart(scope: MedusaContainer, cartId: string): Promise<CartPricing> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "region_id", "currency_code", "customer_id"],
    filters: { id: cartId },
  })
  const cart = data[0] as CartPricing | undefined
  if (!cart) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${cartId} not found`)
  return cart
}

/** Prices an offer at its own shop's price in the cart's region. */
async function priceLine(scope: MedusaContainer, cart: CartPricing, offerId: string): Promise<OfferLinePrice> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: offers } = await query.graph({
    entity: "offer",
    fields: ["id", "seller_id", "variant_id", "product_variant.price_set.id"],
    filters: { id: offerId },
  })
  const offer = offers[0] as
    | { id: string; seller_id: string; variant_id: string; product_variant?: { price_set?: { id: string } | null } }
    | undefined
  // Buyers can't see a shop that isn't live (onboarding gates, #26), so its offers aren't there to buy.
  if (!offer || !(await isLive(scope, offer.seller_id))) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Offer ${offerId} not found`)
  }
  if (!cart.region_id) throw new MedusaError(MedusaError.Types.INVALID_DATA, "The cart has no region to price it in")

  const [priced] = await priceOffers(scope, { id: cart.region_id, currency_code: cart.currency_code }, [offer])
  if (!priced) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Offer ${offerId} has no price in the cart's currency`)
  }
  const { calculated_amount, original_amount, is_calculated_price_tax_inclusive } = priced.calculated_price
  const unitPrice = Number(calculated_amount)
  const originalPrice = Number(original_amount ?? calculated_amount)
  return {
    offer_id: offer.id,
    seller_id: offer.seller_id,
    variant_id: offer.variant_id,
    unit_price: unitPrice,
    // A sale shows the shop's normal price struck through, as on the product page.
    compare_at_unit_price: originalPrice > unitPrice ? originalPrice : null,
    is_tax_inclusive: !!is_calculated_price_tax_inclusive,
  }
}

/** The offer's current price for a cart, for repricing one of its lines. */
export async function offerLinePrice(scope: MedusaContainer, cartId: string, offerId: string) {
  return priceLine(scope, await loadCart(scope, cartId), offerId)
}

/** The offer a cart's line item was added from, or null when it has none. */
export async function lineItemOfferId(scope: MedusaContainer, cartId: string, lineItemId: string) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "line_item",
    fields: ["id", "metadata", "offer.id"],
    filters: { id: lineItemId, cart_id: cartId },
  })
  const item = data[0] as Parameters<typeof offerIdOf>[0] | undefined
  return item ? offerIdOf(item) : null
}

export type OfferLine = { offer_id: string; quantity: number; metadata?: Record<string, unknown> | null }

async function addPricedLines(
  scope: MedusaContainer,
  cartId: string,
  lines: { line: OfferLine; price: OfferLinePrice }[],
  additionalData?: Record<string, unknown>
) {
  if (!lines.length) return
  await addToCartWorkflow(scope).run({
    input: {
      cart_id: cartId,
      items: lines.map(({ line, price }) => ({
        quantity: line.quantity,
        variant_id: price.variant_id,
        unit_price: price.unit_price,
        compare_at_unit_price: price.compare_at_unit_price,
        is_tax_inclusive: price.is_tax_inclusive,
        requires_shipping: true,
        // Mercur's pricing and validation hooks read `offer_id` from the item; its
        // cart refresh links the line to the offer from the metadata.
        offer_id: line.offer_id,
        metadata: { ...line.metadata, offer_id: line.offer_id },
      })) as never,
      additional_data: additionalData,
    },
  })
}

/**
 * Adds offers to a cart, each at its own shop's price. An unknown offer is not found; a shop
 * in a closed exception or paused refuses (ADR 0004).
 */
export async function addOffersToCart(
  scope: MedusaContainer,
  cartId: string,
  lines: OfferLine[],
  additionalData?: Record<string, unknown>
) {
  const cart = await loadCart(scope, cartId)
  const priced = await Promise.all(lines.map(async (line) => ({ line, price: await priceLine(scope, cart, line.offer_id) })))
  await refuseClosedShops(scope, priced.map((p) => p.price.seller_id))
  await addPricedLines(scope, cartId, priced, additionalData)
}

/**
 * Adds another cart's lines to the buyer's own cart, repriced at each offer's current price
 * (the buyer signed in holding a guest cart while already having one). Both carts must be
 * theirs or ownerless; any other is not found. Lines whose offer is gone are left behind.
 */
export async function mergeCarts(
  scope: MedusaContainer,
  { targetId, sourceId, customerId }: { targetId: string; sourceId: string; customerId: string }
) {
  const [target, source] = await Promise.all([loadCart(scope, targetId), loadCart(scope, sourceId)])
  const notFound = (id: string) => new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${id} not found`)
  if (target.customer_id !== customerId) throw notFound(targetId)
  if (source.customer_id && source.customer_id !== customerId) throw notFound(sourceId)
  if (target.id === source.id) return

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "items.quantity", "items.metadata", "items.offer.id"],
    filters: { id: sourceId },
  })
  const items = ((data[0] as { items?: ({ quantity: number | string } & Parameters<typeof offerIdOf>[0])[] })?.items ?? [])
  const lines = items.flatMap((item) => {
    const offerId = offerIdOf(item)
    return offerId ? [{ offer_id: offerId, quantity: Number(item.quantity) }] : []
  })
  const priced = await Promise.all(
    lines.map(async (line) => {
      try {
        return [{ line, price: await priceLine(scope, target, line.offer_id) }]
      } catch (error) {
        // The shop stopped selling it: nothing to carry over.
        if (error instanceof MedusaError) return []
        throw error
      }
    })
  )
  await addPricedLines(scope, targetId, priced.flat())
}
