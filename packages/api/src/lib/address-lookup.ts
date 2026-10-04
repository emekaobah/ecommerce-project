import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { LookedUpPlace } from "@oja/domain"
import { ADDRESS_LOOKUP_MODULE, type AddressLookupModuleService, type AddressSuggestion } from "../modules/address-lookup"

// Address lookup for the buyer's delivery address (ADR 0002, #40): Google's suggestions, a
// place's address, and the address at the buyer's location, through the backend's key. Lookups
// are confined to the countries of the buyer's cart's region; the app never names a country.

type CartRegion = {
  customer_id: string | null
  region?: { metadata?: Record<string, unknown> | null; countries?: { iso_2: string }[] | null } | null
}

/** The buyer's cart region's lookup provider and countries. Another buyer's cart is not found. */
async function lookupFor(scope: MedusaContainer, cartId: string, customerId: string) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["customer_id", "region.metadata", "region.countries.iso_2"],
    filters: { id: cartId },
  })
  const cart = data[0] as CartRegion | undefined
  if (!cart?.region || cart.customer_id !== customerId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${cartId} not found`)
  }
  const lookups = scope.resolve<AddressLookupModuleService>(ADDRESS_LOOKUP_MODULE)
  return {
    provider: lookups.providerFor(cart.region),
    countries: (cart.region.countries ?? []).map((c) => c.iso_2.toLowerCase()),
  }
}

export type LookupScope = { cartId: string; customerId: string }

/** Places matching what the buyer typed, in their cart region's countries. */
export async function suggestAddresses(
  scope: MedusaContainer,
  { cartId, customerId, text, sessionToken }: LookupScope & { text: string; sessionToken: string }
): Promise<AddressSuggestion[]> {
  const { provider, countries } = await lookupFor(scope, cartId, customerId)
  return provider.suggest({ text, sessionToken, countries })
}

/** A suggested place's address. A place outside the cart region's countries is not found. */
export async function placeAddress(
  scope: MedusaContainer,
  { cartId, customerId, placeId, sessionToken }: LookupScope & { placeId: string; sessionToken: string }
): Promise<LookedUpPlace> {
  const { provider, countries } = await lookupFor(scope, cartId, customerId)
  const place = await provider.details({ placeId, sessionToken })
  if (!place?.country_code || !countries.includes(place.country_code.toLowerCase())) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "We don't deliver to this place")
  }
  return place
}

/** The address at the buyer's location, or null when it isn't in the cart region's countries. */
export async function addressAt(
  scope: MedusaContainer,
  { cartId, customerId, latitude, longitude }: LookupScope & { latitude: number; longitude: number }
): Promise<LookedUpPlace | null> {
  const { provider, countries } = await lookupFor(scope, cartId, customerId)
  return provider.reverseGeocode({ latitude, longitude, countries })
}
