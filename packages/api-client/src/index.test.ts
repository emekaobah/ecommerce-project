import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { ClientError, createStoreClient, createVendorClient } from "./index"

const baseUrl = "http://api.test"
const realFetch = globalThis.fetch
let requests: Request[]
let status: number

beforeEach(() => {
  requests = []
  status = 200
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init))
    return Response.json(status === 200 ? { ok: true } : { message: "Unauthorized" }, { status })
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("createVendorClient", () => {
  test("reads the token and seller id on every request, so a session can change without a new client", async () => {
    let session = { token: "token-a", sellerId: "sel_a" }
    const client = createVendorClient({
      baseUrl,
      getToken: () => session.token,
      getSellerId: async () => session.sellerId,
    })

    await client.vendor.orders.query({ limit: 5 })
    session = { token: "token-b", sellerId: "sel_b" }
    await client.vendor.orders.query({ limit: 5 })

    expect(requests.map((r) => r.headers.get("authorization"))).toEqual(["Bearer token-a", "Bearer token-b"])
    expect(requests.map((r) => r.headers.get("x-seller-id"))).toEqual(["sel_a", "sel_b"])
    expect(requests[0]?.url).toBe("http://api.test/vendor/orders?limit=5")
  })

  test("sends no auth headers when signed out", async () => {
    const client = createVendorClient({ baseUrl, getToken: () => null, getSellerId: () => null })

    await client.vendor.sellers.query()

    expect(requests[0]?.headers.get("authorization")).toBeNull()
    expect(requests[0]?.headers.get("x-seller-id")).toBeNull()
  })

  test("reports a 401 so the app can sign the member out, and still rejects", async () => {
    status = 401
    const onUnauthorized = mock(() => {})
    const client = createVendorClient({ baseUrl, getToken: () => "expired", onUnauthorized })

    await expect(client.vendor.orders.query()).rejects.toBeInstanceOf(ClientError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  test("ignores a 401 for a token the session has since replaced, so a stale request can't sign out the next member", async () => {
    status = 401
    let token = "member-a"
    const onUnauthorized = mock(() => {})
    const client = createVendorClient({ baseUrl, getToken: () => token, onUnauthorized })
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      // Member A signs out and member B signs in while A's request is in flight.
      token = "member-b"
      requests.push(new Request(input, init))
      return Response.json({ message: "Unauthorized" }, { status: 401 })
    }) as unknown as typeof fetch

    await expect(client.vendor.orders.query()).rejects.toBeInstanceOf(ClientError)
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer member-a")
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})

describe("createStoreClient", () => {
  test("sends the publishable key, plus the customer token only when signed in", async () => {
    let token: string | null = null
    const client = createStoreClient({ baseUrl, publishableKey: "pk_1", getToken: async () => token })

    await client.store.regions.query()
    token = "clerk-jwt"
    await client.store.regions.query()

    expect(requests.map((r) => r.headers.get("x-publishable-api-key"))).toEqual(["pk_1", "pk_1"])
    expect(requests.map((r) => r.headers.get("authorization"))).toEqual([null, "Bearer clerk-jwt"])
  })

  test("after a 401, retries once with a freshly issued token, and keeps the session when that works", async () => {
    const calls: boolean[] = []
    const onUnauthorized = mock(() => {})
    const client = createStoreClient({
      baseUrl,
      publishableKey: "pk_1",
      getToken: async ({ fresh }) => {
        calls.push(fresh)
        return fresh ? "fresh-jwt" : "stale-jwt"
      },
      onUnauthorized,
    })
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      const ok = request.headers.get("authorization") === "Bearer fresh-jwt"
      return Response.json(ok ? { ok: true } : { message: "Unauthorized" }, { status: ok ? 200 : 401 })
    }) as unknown as typeof fetch

    expect(await client.store.regions.query()).toMatchObject({ ok: true } as object)
    expect(calls).toEqual([false, true])
    expect(requests.map((r) => r.headers.get("authorization"))).toEqual(["Bearer stale-jwt", "Bearer fresh-jwt"])
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  test("signs the buyer out when a fresh token is rejected too, and still rejects", async () => {
    status = 401
    const onUnauthorized = mock(() => {})
    const client = createStoreClient({ baseUrl, publishableKey: "pk_1", getToken: async () => "revoked", onUnauthorized })

    await expect(client.store.regions.query()).rejects.toBeInstanceOf(ClientError)
    expect(requests).toHaveLength(2)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  test("neither retries nor signs out a guest's 401", async () => {
    status = 401
    const onUnauthorized = mock(() => {})
    const client = createStoreClient({ baseUrl, publishableKey: "pk_1", getToken: async () => null, onUnauthorized })

    await expect(client.store.customers.me.query()).rejects.toBeInstanceOf(ClientError)
    expect(requests).toHaveLength(1)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
