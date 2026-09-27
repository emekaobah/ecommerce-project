import { ClientError, createClient } from "@mercurjs/client"
import type { Routes } from "@acme/api/_generated"
import type { TypedClient } from "./types"

/** Fully typed client over every Medusa + Mercur route, generated from the API workspace. */
export type OjaClient = TypedClient<Routes>

export { ClientError }

type Awaitable<T> = T | Promise<T>
/** Reads a value at request time; null or undefined means "don't send it". */
export type Getter = () => Awaitable<string | null | undefined>

type DynamicClientConfig = {
  baseUrl: string
  /** Resolved before every request. */
  headers: () => Promise<Record<string, string>>
  /** Called with the headers the request carried when it is rejected with 401, before the error is rethrown. */
  onUnauthorized?: (sent: Record<string, string>) => void
}

/**
 * A client whose headers are resolved per request. `@mercurjs/client` fixes headers
 * when it is created, so each call builds a throwaway client with the current ones.
 */
function createDynamicClient({ baseUrl, headers, onUnauthorized }: DynamicClientConfig): OjaClient {
  const call = async (path: string[], args: unknown[]) => {
    const sent = await headers()
    let target: any = createClient({ baseUrl, fetchOptions: { headers: sent } })
    for (const segment of path) target = target[segment]
    try {
      return await target(...args)
    } catch (error) {
      if (error instanceof ClientError && error.status === 401) onUnauthorized?.(sent)
      throw error
    }
  }
  const proxy = (path: string[]): unknown =>
    new Proxy(() => {}, {
      // Not thenable, so a client path is never mistaken for a promise.
      get: (_, prop) => (typeof prop !== "string" || prop === "then" ? undefined : proxy([...path, prop])),
      apply: (_, __, args) => call(path, args),
    })
  return proxy([]) as OjaClient
}

async function bearer(getToken: Getter | undefined): Promise<Record<string, string>> {
  const token = await getToken?.()
  return token ? { authorization: `Bearer ${token}` } : {}
}

export type StoreClientConfig = {
  baseUrl: string
  /** Store API requests are scoped to a sales channel by a publishable key. */
  publishableKey: string
  /** Customer session token (Clerk); guests return null. */
  getToken?: Getter
}

/** Client for the buyer app: Store API, by publishable key plus the customer's token when signed in. */
export function createStoreClient({ baseUrl, publishableKey, getToken }: StoreClientConfig): OjaClient {
  return createDynamicClient({
    baseUrl,
    headers: async () => ({ "x-publishable-api-key": publishableKey, ...(await bearer(getToken)) }),
  })
}

export type VendorClientConfig = {
  baseUrl: string
  /** Member JWT from `loginMember`. */
  getToken?: Getter
  /** Seller the member is acting for; required by every seller-scoped vendor route. */
  getSellerId?: Getter
  /**
   * The member's session is no longer valid; the app signs them out. Not called when the
   * rejected request carried a token the session has since replaced.
   */
  onUnauthorized?: () => void
}

/** Client for the vendor app: Vendor API, authenticated as a seller member. */
export function createVendorClient({ baseUrl, getToken, getSellerId, onUnauthorized }: VendorClientConfig): OjaClient {
  return createDynamicClient({
    baseUrl,
    onUnauthorized: async (sent) => {
      if (sent.authorization === (await bearer(getToken)).authorization) onUnauthorized?.()
    },
    headers: async () => {
      const sellerId = await getSellerId?.()
      return { ...(await bearer(getToken)), ...(sellerId ? { "x-seller-id": sellerId } : {}) }
    },
  })
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
