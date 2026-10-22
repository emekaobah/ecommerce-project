import { ClientError, createClient } from "@mercurjs/client"
import type { Routes } from "@acme/api/_generated"
import type { TypedClient } from "./types"

/** Fully typed client over every Medusa + Mercur route, generated from the API workspace. */
export type OjaClient = TypedClient<Routes>

export { ClientError }

/**
 * A refused request, with the error response's whole JSON body, so an app reads a refusal's own
 * fields, such as when a locked pickup counter may try again (`retry_at`, #70). Still a
 * `ClientError`; `@mercurjs/client` keeps only the body's message and code.
 */
export class ApiError extends ClientError {
  constructor(
    error: ClientError,
    /** The error response's JSON body; empty when it wasn't JSON. */
    readonly body: Record<string, unknown>
  ) {
    super(error.message, error.statusText, error.status, error.code)
    this.name = "ApiError"
    this.stack = error.stack
  }
}

type Awaitable<T> = T | Promise<T>
/** Reads a value at request time; null or undefined means "don't send it". */
export type Getter = () => Awaitable<string | null | undefined>
/** Reads the session token; `fresh` asks for a newly issued one instead of a cached one. */
export type TokenGetter = (options: { fresh: boolean }) => Awaitable<string | null | undefined>

type DynamicClientConfig = {
  baseUrl: string
  /** Resolved before every request. */
  headers: () => Promise<Record<string, string>>
  /**
   * After a 401, headers to retry the request with once (e.g. a freshly issued token), or
   * null to not retry. Safe for writes too: a 401 means the request was never handled.
   */
  retryHeaders?: (sent: Record<string, string>) => Promise<Record<string, string> | null>
  /** Called with the headers the final attempt carried when it is rejected with 401, before the error is rethrown. */
  onUnauthorized?: (sent: Record<string, string>) => void
}

/**
 * A client whose headers are resolved per request. `@mercurjs/client` fixes headers
 * when it is created, so each call builds a throwaway client with the current ones.
 */
function createDynamicClient({ baseUrl, headers, retryHeaders, onUnauthorized }: DynamicClientConfig): OjaClient {
  const isUnauthorized = (error: unknown) => error instanceof ClientError && error.status === 401
  const send = async (path: string[], args: unknown[], sent: Record<string, string>) => {
    let target: any = createClient({ baseUrl, fetchOptions: { headers: sent } })
    for (const segment of path) target = target[segment]
    // `@mercurjs/client` reads a refused response's body and keeps only its message and code. It
    // calls `fetch` before the call returns, so a copy of this request's refused response is
    // kept by swapping `fetch` for the call alone; no other request can run in between.
    const fetchNow = globalThis.fetch
    let refused: Response | undefined
    globalThis.fetch = (async (...request: Parameters<typeof fetch>) => {
      const response = await fetchNow(...request)
      if (response.status >= 300) refused = response.clone()
      return response
    }) as typeof fetch
    let pending: Promise<unknown>
    try {
      pending = target(...args)
    } finally {
      globalThis.fetch = fetchNow
    }
    try {
      return await pending
    } catch (error) {
      if (!(error instanceof ClientError) || !refused) throw error
      const body = await refused.json().catch(() => ({}))
      throw new ApiError(error, body && typeof body === "object" ? (body as Record<string, unknown>) : {})
    }
  }
  const call = async (path: string[], args: unknown[]) => {
    let sent = await headers()
    try {
      return await send(path, args, sent)
    } catch (error) {
      if (!isUnauthorized(error)) throw error
      const retry = await retryHeaders?.(sent)
      if (!retry) {
        onUnauthorized?.(sent)
        throw error
      }
      sent = retry
    }
    try {
      return await send(path, args, sent)
    } catch (error) {
      if (isUnauthorized(error)) onUnauthorized?.(sent)
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
  getToken?: TokenGetter
  /** A fresh token was rejected too, so the session is no longer valid; the app signs the buyer out. */
  onUnauthorized?: () => void
}

/**
 * Client for the buyer app: Store API, by publishable key plus the customer's token when signed in.
 * A rejected token is retried once with a freshly issued one before the buyer is signed out.
 */
export function createStoreClient({ baseUrl, publishableKey, getToken, onUnauthorized }: StoreClientConfig): OjaClient {
  const headersWith = async (fresh: boolean) => ({
    "x-publishable-api-key": publishableKey,
    ...(await bearer(() => getToken?.({ fresh }))),
  })
  return createDynamicClient({
    baseUrl,
    headers: () => headersWith(false),
    // A guest's 401 isn't a session problem: no retry, no sign-out.
    retryHeaders: async (sent) => (sent.authorization ? headersWith(true) : null),
    onUnauthorized: (sent) => {
      if (sent.authorization) onUnauthorized?.()
    },
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
