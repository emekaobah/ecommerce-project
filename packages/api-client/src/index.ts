import { ClientError, createClient } from "@mercurjs/client"
import type { HttpTypes } from "@medusajs/types"
import type { Routes } from "@acme/api/_generated"
import type { TypedClient } from "./types"

/** Fully typed client over every Medusa + Mercur route, generated from the API workspace. */
export type OjaClient = TypedClient<Routes>

export { ClientError }

export type StoreClientConfig = {
  baseUrl: string
  /** Store API requests are scoped to a sales channel by a publishable key. */
  publishableKey: string
}

/** Client for the buyer app: Store API, authenticated by publishable key (and later a customer token). */
export function createStoreClient({ baseUrl, publishableKey }: StoreClientConfig): OjaClient {
  return createClient({
    baseUrl,
    fetchOptions: { headers: { "x-publishable-api-key": publishableKey } },
  })
}

export type VendorClientConfig = {
  baseUrl: string
  /** Member JWT from `loginMember`. */
  token?: string
  /** Seller the member is acting for; required by every seller-scoped vendor route. */
  sellerId?: string
}

/** Client for the vendor app: Vendor API, authenticated as a seller member. */
export function createVendorClient({ baseUrl, token, sellerId }: VendorClientConfig): OjaClient {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (sellerId) headers["x-seller-id"] = sellerId
  return createClient({ baseUrl, fetchOptions: { headers } })
}

/** Exchange member email/password for a JWT. */
export async function loginMember(
  baseUrl: string,
  credentials: { email: string; password: string }
): Promise<string> {
  const client = createVendorClient({ baseUrl })
  const result = (await client.auth.$actorType.$authProvider.mutate({
    $actorType: "member",
    $authProvider: "emailpass",
    ...credentials,
  })) as { token?: string; location?: string }
  if (!result.token) {
    throw new ClientError("Login did not return a token")
  }
  return result.token
}

/**
 * Formats a Medusa amount (major units, e.g. 1500 = ₦1,500) for display.
 * Currency always comes from the region/order — never hardcoded.
 */
export function formatMoney(amount: number, currencyCode: string, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode.toUpperCase(),
  }).format(amount)
}

/**
 * Lists catalogue products priced for a region. Mercur's store products handler
 * doesn't type its response, so the Medusa list shape is applied here.
 */
export async function listStoreProducts(
  client: OjaClient,
  params: { regionId: string; limit?: number; offset?: number }
): Promise<HttpTypes.StoreProductListResponse> {
  return (await client.store.products.query({
    region_id: params.regionId,
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
  })) as HttpTypes.StoreProductListResponse
}
