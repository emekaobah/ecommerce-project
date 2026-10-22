import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import wishlistProduct from "../links/wishlist-product"
import { getWishlistFromCustomerId } from "../modules/wishlist/utils"
import { createWishlistEntryWorkflow } from "../workflows/wishlist/workflows/create-wishlist"
import { deleteWishlistEntryWorkflow } from "../workflows/wishlist/workflows/delete-wishlist"
import { retrieveCartBySeller, type CartBySeller } from "./cart"
import { addOffersToCart } from "./cart-lines"
import { listListings, type Listing, type ListingProduct } from "./listings"

// A buyer's wishlist, built on Mercur's wishlist block (products only). Products are
// always shown as one shop's offer (docs/design.md), so each saved product keeps the
// shop it was saved from, and the wishlist shows and moves that shop's offer.

export type WishlistItem = {
  product: ListingProduct
  seller_id: string
  /** The shop's listing in the region; null when the shop no longer sells it there, so it can only be removed. */
  listing: Listing | null
}

type Saved = { product_id: string; seller_id: string }

/** The customer's wishlist and the products saved in it, newest first, each with the shop it was saved from. */
async function savedProducts(scope: MedusaContainer, customerId: string): Promise<{ wishlistId: string | null; saved: Saved[] }> {
  const wishlist = await getWishlistFromCustomerId(scope, customerId)
  if (!wishlist) return { wishlistId: null, saved: [] }
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: wishlistProduct.entryPoint,
    fields: ["product_id", "seller_id", "created_at"],
    filters: { wishlist_id: wishlist.id },
  })
  const saved = (data as (Saved & { created_at: string | Date })[])
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map(({ product_id, seller_id }) => ({ product_id, seller_id }))
  return { wishlistId: wishlist.id, saved }
}

/** The shop's offers of the product, or not found when it doesn't sell it. */
export async function shopOfferIds(scope: MedusaContainer, sellerId: string, productId: string): Promise<string[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "offer",
    fields: ["id"],
    filters: { seller_id: sellerId, product_id: productId },
    pagination: { order: { created_at: "ASC", id: "ASC" } },
  })
  if (!data.length) throw new MedusaError(MedusaError.Types.NOT_FOUND, "This shop doesn't sell that product")
  return (data as { id: string }[]).map((o) => o.id)
}

/** The customer's wishlist in a region, newest first, each product as its saved shop's listing. */
export async function listWishlist(
  scope: MedusaContainer,
  customerId: string,
  filters: { regionId: string; salesChannelIds: string[] }
): Promise<WishlistItem[]> {
  const { saved } = await savedProducts(scope, customerId)
  if (!saved.length) return []
  const productIds = saved.map((s) => s.product_id)

  // Each saved product is at most one listing: its saved shop's.
  const { listings } = await listListings(scope, { ...filters, pairs: saved }, { limit: saved.length, offset: 0 })
  const listingOf = new Map(listings.map((l) => [`${l.seller.id}:${l.product.id}`, l]))

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "thumbnail"],
    filters: { id: productIds },
  })
  const products = new Map((data as ListingProduct[]).map((p) => [p.id, p]))

  // A product deleted from the catalogue is dropped rather than shown without a name.
  return saved
    .filter((s) => products.has(s.product_id))
    .map((s) => ({
      product: products.get(s.product_id)!,
      seller_id: s.seller_id,
      listing: listingOf.get(`${s.seller_id}:${s.product_id}`) ?? null,
    }))
}

/**
 * Moves a saved product into the customer's cart as its saved shop's offer, then takes it
 * off the wishlist. The offer may be omitted when the shop sells the product in one variant
 * only; otherwise the buyer must choose. Only the customer's own cart is found.
 *
 * It leaves the wishlist before it reaches the cart, and goes back if adding fails, so a
 * retried move never adds it twice: at worst a failure while putting it back loses the entry.
 */
export async function moveToCart(
  scope: MedusaContainer,
  input: { customerId: string; productId: string; cartId: string; offerId?: string; quantity: number }
): Promise<CartBySeller> {
  const { wishlistId, saved: all } = await savedProducts(scope, input.customerId)
  const saved = all.find((s) => s.product_id === input.productId)
  if (!wishlistId || !saved) throw new MedusaError(MedusaError.Types.NOT_FOUND, "That product isn't in your wishlist")

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({ entity: "cart", fields: ["id", "customer_id"], filters: { id: input.cartId } })
  const cart = carts[0] as { id: string; customer_id: string | null } | undefined
  if (cart?.customer_id !== input.customerId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${input.cartId} not found`)
  }

  const offerIds = await shopOfferIds(scope, saved.seller_id, saved.product_id)
  const offerId = input.offerId ?? (offerIds.length === 1 ? offerIds[0] : undefined)
  if (!offerId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose which one to add to the cart")
  if (!offerIds.includes(offerId)) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "The shop doesn't sell that option of the product")
  }

  await deleteWishlistEntryWorkflow(scope).run({ input: { id: wishlistId, reference_id: input.productId } })
  try {
    await addOffersToCart(scope, input.cartId, [{ offer_id: offerId, quantity: input.quantity }])
  } catch (error) {
    await createWishlistEntryWorkflow(scope).run({
      input: { reference: "product", reference_id: saved.product_id, seller_id: saved.seller_id, customer_id: input.customerId },
    })
    throw error
  }
  return retrieveCartBySeller(scope, input.cartId)
}
