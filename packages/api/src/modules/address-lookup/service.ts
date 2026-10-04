import { MedusaError } from "@medusajs/framework/utils"
import { GoogleAddressLookup, type GoogleOptions } from "./google"
import type { AddressLookupProvider } from "./provider"

export type AddressLookupOptions = {
  google?: Partial<GoogleOptions>
}

/** The providers by the id a region names in `metadata.address_lookup_provider`. */
type ProviderId = "google"
export const DEFAULT_ADDRESS_LOOKUP_PROVIDER: ProviderId = "google"

/**
 * The address lookup providers (ADR 0002). Apps never call Google themselves; the store's
 * lookup routes go through here with the server's key.
 */
export default class AddressLookupModuleService {
  private readonly providers: Record<ProviderId, AddressLookupProvider>

  constructor(_container: unknown, options: AddressLookupOptions = {}) {
    const apiKey = options.google?.apiKey
    // Tests fake Google at the network boundary and set the key only where they do.
    if (!apiKey && process.env.NODE_ENV !== "test") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Address lookup needs GOOGLE_MAPS_API_KEY")
    }
    this.providers = { google: new GoogleAddressLookup({ ...options.google, apiKey: apiKey ?? "" }) }
  }

  /** The provider a region looks addresses up with: its `metadata.address_lookup_provider`, else Google. */
  providerFor(region: { metadata?: Record<string, unknown> | null }): AddressLookupProvider {
    const id = region.metadata?.address_lookup_provider ?? DEFAULT_ADDRESS_LOOKUP_PROVIDER
    const provider = this.providers[id as ProviderId]
    if (!provider) throw new MedusaError(MedusaError.Types.INVALID_DATA, `No address lookup provider "${String(id)}"`)
    return provider
  }
}
