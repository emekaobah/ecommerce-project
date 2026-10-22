import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { buyerReviewCounts } from "./reviews"
import { countWishlist } from "./wishlist"

// The buyer's Account screen (#73): their own things, counted in one request.

/** The buyer's saved addresses: how many, and the default's street ("14 Bode Thomas St"), if one is the default. */
export type AddressesSummary = { count: number; default_label: string | null }

export type AccountSummary = {
  /** Products on the buyer's wishlist. */
  saved_items: number
  /** The reviews the buyer wrote, of shops and products, whatever their moderation. */
  reviews_written: number
  /** The buyer's delivered or collected orders with a shop or product not yet reviewed (#7). */
  orders_to_review: number
  addresses: AddressesSummary
}

type AddressRow = { address_1: string | null; is_default_shipping: boolean }

async function addressesSummary(scope: MedusaContainer, customerId: string): Promise<AddressesSummary> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "customer_address",
    fields: ["address_1", "is_default_shipping"],
    filters: { customer_id: customerId },
  })
  const addresses = data as unknown as AddressRow[]
  return {
    count: addresses.length,
    default_label: addresses.find((a) => a.is_default_shipping)?.address_1 ?? null,
  }
}

/** The counts on the buyer's Account screen. */
export async function accountSummary(scope: MedusaContainer, customerId: string): Promise<AccountSummary> {
  const [saved_items, reviews, addresses] = await Promise.all([
    countWishlist(scope, customerId),
    buyerReviewCounts(scope, customerId),
    addressesSummary(scope, customerId),
  ])
  return { saved_items, ...reviews, addresses }
}
