import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { LookedUpPlace } from "@oja/domain"
import { currencyOf } from "./onboarding"
import { ADDRESS_LOOKUP_MODULE, type AddressLookupModuleService, type AddressSuggestion } from "../modules/address-lookup"

// Address lookup (ADR 0002): Google's suggestions, a place's address, and the address at a
// point, through the backend's key. A buyer's delivery address (#40) is confined to the countries
// of their cart's region or, for a saved address added with no cart (#18), of the region the app
// shops in. A shop's pickup address (#41) is confined to the countries of the region it trades
// in (its currency's). The apps never name a country.

type LookupRegion = { metadata?: Record<string, unknown> | null; countries?: { iso_2: string }[] | null }
type CartRegion = { customer_id: string | null; region?: LookupRegion | null }

/**
 * Who looks up: a buyer, for their cart or for a region (one of the two, as the store routes
 * check), or a shop, for its pickup address.
 */
export type LookupScope = { customerId: string; cartId?: string; regionId?: string } | { sellerId: string }

/**
 * The region a lookup is for: the buyer's cart's, or the one named; or the region the shop
 * trades in. Another buyer's cart is not found.
 */
async function regionFor(scope: MedusaContainer, lookup: LookupScope): Promise<LookupRegion> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  if ("sellerId" in lookup) return shopRegion(scope, lookup.sellerId)
  const { cartId, regionId, customerId } = lookup
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

/** The region trading in the shop's currency, as the vendor panel's address form also takes it (lib/onboarding.ts). */
async function shopRegion(scope: MedusaContainer, sellerId: string): Promise<LookupRegion> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const currency = await currencyOf(scope, sellerId)
  // One region per currency today (NGN, Nigeria); like `countryForCurrency`, the first one wins.
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["metadata", "countries.iso_2"],
    filters: { currency_code: currency },
  })
  const region = regions[0] as LookupRegion | undefined
  if (!region) throw new MedusaError(MedusaError.Types.NOT_FOUND, `No region trades in ${currency.toUpperCase()} yet`)
  return region
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

/** Places matching what was typed, in the region's countries. */
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

/** The address at a point (the buyer's or the shop owner's location), or null when it isn't in the region's countries. */
export async function addressAt(
  scope: MedusaContainer,
  { latitude, longitude, ...lookup }: LookupScope & { latitude: number; longitude: number }
): Promise<LookedUpPlace | null> {
  const { provider, countries } = await lookupFor(scope, lookup)
  return provider.reverseGeocode({ latitude, longitude, countries })
}
