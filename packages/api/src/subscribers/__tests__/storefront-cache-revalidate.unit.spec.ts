import storefrontCacheRevalidateHandler from "../storefront-cache-revalidate"

const HANDLES: Record<string, string> = { prod_rice: "ofada-rice", prod_garri: "garri" }

const container = {
  resolve: () => ({
    graph: async ({ filters }: { filters: { id: string } }) => ({ data: [{ handle: HANDLES[filters.id] }] }),
  }),
} as any

describe("storefrontCacheRevalidateHandler", () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true })

  beforeEach(() => {
    fetchMock.mockClear()
    global.fetch = fetchMock
    process.env.STOREFRONT_REVALIDATE_URL = "https://storefront.test/revalidate"
    process.env.STOREFRONT_REVALIDATE_SECRET = "secret"
  })

  afterEach(() => {
    delete process.env.STOREFRONT_REVALIDATE_URL
    delete process.env.STOREFRONT_REVALIDATE_SECRET
  })

  it("revalidates every offer's tags in a batched event with one request", async () => {
    await storefrontCacheRevalidateHandler({
      event: {
        name: "offer.updated",
        data: [
          { id: "off_1", product_id: "prod_rice" },
          { id: "off_2", product_id: "prod_garri" },
        ],
      },
      container,
    } as any)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://storefront.test/revalidate")
    expect(init.headers["x-revalidate-secret"]).toBe("secret")
    expect(JSON.parse(init.body).tags.sort()).toEqual(
      [
        "offer-off_1",
        "offer-off_2",
        "offers",
        "product-garri",
        "product-offers-prod_garri",
        "product-offers-prod_rice",
        "product-ofada-rice",
        "products",
      ].sort()
    )
  })

  it("sends nothing when the storefront isn't configured", async () => {
    delete process.env.STOREFRONT_REVALIDATE_URL
    await storefrontCacheRevalidateHandler({ event: { name: "product.updated", data: { id: "prod_rice" } }, container } as any)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
