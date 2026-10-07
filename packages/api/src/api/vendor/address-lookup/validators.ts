import { z } from "@medusajs/framework/zod"
import { point, searchInput, sessionToken } from "../../store/address-lookup/validators"

// The shop's own region decides the countries searched (ADR 0002, #41), so a vendor lookup
// names no cart or region.

export const VendorSuggestAddresses = z.object({ session_token: sessionToken, input: searchInput })
export type VendorSuggestAddressesType = z.infer<typeof VendorSuggestAddresses>

export const VendorGetPlaceAddress = z.object({ session_token: sessionToken })
export type VendorGetPlaceAddressType = z.infer<typeof VendorGetPlaceAddress>

export const VendorReverseGeocode = z.object(point)
export type VendorReverseGeocodeType = z.infer<typeof VendorReverseGeocode>
