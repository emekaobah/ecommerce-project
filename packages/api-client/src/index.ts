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

/** Where `keepRefusedResponses`' fetch leaves a copy of a request's refused response. */
type RefusedSink = { response?: Response }
/** The request option naming a request's sink; `@mercurjs/client` copies its `fetchOptions` onto each request. */
const REFUSED_SINK = Symbol("oja.refusedSink")
const KEEPS_REFUSED = Symbol("oja.keepsRefused")

/**
 * `@mercurjs/client` calls the global `fetch` and reads a refused response's body itself, so
 * `fetch` is wrapped, once, to leave a copy of each refused response in the sink its request
 * names. The wrapper holds no state of its own: overlapping requests each have their own sink.
 * Wraps whichever `fetch` is current if it isn't wrapped yet (a test may install its own).
 */
function keepRefusedResponses() {
  const underlying = globalThis.fetch as typeof fetch & { [KEEPS_REFUSED]?: true }
  if (underlying[KEEPS_REFUSED]) return
  const keeping = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await underlying(input, init)
    const sink = (init as { [REFUSED_SINK]?: RefusedSink } | undefined)?.[REFUSED_SINK]
    if (sink && response.status >= 300) sink.response = response.clone()
    return response
  }
  globalThis.fetch = Object.assign(keeping, { [KEEPS_REFUSED]: true as const }) as unknown as typeof fetch
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
    keepRefusedResponses()
    const sink: RefusedSink = {}
    let target: any = createClient({ baseUrl, fetchOptions: { headers: sent, [REFUSED_SINK]: sink } as RequestInit })
    for (const segment of path) target = target[segment]
    try {
      return await target(...args)
    } catch (error) {
      if (!(error instanceof ClientError) || !sink.response) throw error
      const body = await sink.response.json().catch(() => ({}))
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
