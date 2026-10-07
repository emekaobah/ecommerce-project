import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { LookedUpPlace } from "@oja/domain"
import { ADDRESS_LOOKUP_MODULE, type AddressLookupModuleService, type AddressSuggestion } from "../modules/address-lookup"

// Address lookup for the buyer's delivery address (ADR 0002, #40): Google's suggestions, a
// place's address, and the address at the buyer's location, through the backend's key. Lookups
// are confined to the countries of the buyer's cart's region or, for a saved address added with
// no cart (#18), of the region the app shops in; the app never names a country.

type LookupRegion = { metadata?: Record<string, unknown> | null; countries?: { iso_2: string }[] | null }
type CartRegion = { customer_id: string | null; region?: LookupRegion | null }

/** Who looks up, for their cart or for a region (one of the two, as the store routes check). */
export type LookupScope = { customerId: string; cartId?: string; regionId?: string }

/** The region a lookup is for: the buyer's cart's, or the one named. Another buyer's cart is not found. */
async function regionFor(scope: MedusaContainer, { cartId, regionId, customerId }: LookupScope): Promise<LookupRegion> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  if (regionId) {
    const { data } = await query.graph({ entity: "region", fields: ["metadata", "countries.iso_2"], filters: { id: regionId } })
    const region = data[0] as LookupRegion | undefined
    if (!region) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Region ${regionId} not found`)
    return region
  }
  const { data } = await query.graph({
    entity: "cart",
    fields: ["customer_id", "region.metadata", "region.countries.iso_2"],
    filters: { id: cartId },
  })
  const cart = data[0] as CartRegion | undefined
  if (!cart?.region || cart.customer_id !== customerId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${cartId} not found`)
  }
  return cart.region
}

/** The lookup provider and countries of the region a lookup is for. */
async function lookupFor(scope: MedusaContainer, lookup: LookupScope) {
  const region = await regionFor(scope, lookup)
  const lookups = scope.resolve<AddressLookupModuleService>(ADDRESS_LOOKUP_MODULE)
  return {
    provider: lookups.providerFor(region),
    countries: (region.countries ?? []).map((c) => c.iso_2.toLowerCase()),
  }
}

/** Places matching what the buyer typed, in the region's countries. */
export async function suggestAddresses(
  scope: MedusaContainer,
  { text, sessionToken, ...lookup }: LookupScope & { text: string; sessionToken: string }
): Promise<AddressSuggestion[]> {
  const { provider, countries } = await lookupFor(scope, lookup)
  return provider.suggest({ text, sessionToken, countries })
}

/** A suggested place's address. A place outside the region's countries is not found. */
export async function placeAddress(
  scope: MedusaContainer,
  { placeId, sessionToken, ...lookup }: LookupScope & { placeId: string; sessionToken: string }
): Promise<LookedUpPlace> {
  const { provider, countries } = await lookupFor(scope, lookup)
  const place = await provider.details({ placeId, sessionToken })
  if (!place) throw new MedusaError(MedusaError.Types.NOT_FOUND, "We couldn't find this place. Search again.")
  if (!place.country_code || !countries.includes(place.country_code.toLowerCase())) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "We don't deliver to this place")
  }
  return place
}

/** The address at the buyer's location, or null when it isn't in the region's countries. */
export async function addressAt(
  scope: MedusaContainer,
  { latitude, longitude, ...lookup }: LookupScope & { latitude: number; longitude: number }
): Promise<LookedUpPlace | null> {
  const { provider, countries } = await lookupFor(scope, lookup)
  return provider.reverseGeocode({ latitude, longitude, countries })
}
