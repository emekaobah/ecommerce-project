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
})
