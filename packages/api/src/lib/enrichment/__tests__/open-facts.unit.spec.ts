import { openFoodFacts } from "../open-facts"

/** A fetch that answers one Open Facts product request, and records what it was asked. */
const fakeFetch = (body: unknown, status = 200) => {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetch = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}

const RICE = {
  status: 1,
  product: {
    product_name: "Mama Gold Rice",
    generic_name: "Long grain parboiled rice",
    product_quantity: "5000",
    product_quantity_unit: "g",
    image_front_url: "https://images.openfoodfacts.org/rice/front.jpg",
    categories_hierarchy: ["en:plant-based-foods", "en:cereals-and-their-products", "en:rices"],
  },
}

describe("Open Food Facts source", () => {
  it("reads a product's name, description, weight in grams, front image and categories, most specific first", async () => {
    const { fetch, calls } = fakeFetch(RICE)

    const match = await openFoodFacts({ fetch }).lookup({ barcode: "5901234123457" })

    expect(match).toEqual({
      url: "https://world.openfoodfacts.org/product/5901234123457",
      fields: {
        title: "Mama Gold Rice",
        description: "Long grain parboiled rice",
        weight: 5000,
        image_urls: ["https://images.openfoodfacts.org/rice/front.jpg"],
        category_names: ["rices", "cereals and their products", "plant based foods"],
      },
    })
    expect(calls[0].url).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/5901234123457\.json\?fields=/)
    // Open Facts asks every client to name itself.
    expect(calls[0].headers["User-Agent"]).toMatch(/^Oja\//)
  })

  it("converts kilograms and leaves out a volume, which isn't a weight", async () => {
    const kilo = fakeFetch({ status: 1, product: { product_name: "Garri", product_quantity: 2, product_quantity_unit: "kg" } })
    const litre = fakeFetch({ status: 1, product: { product_name: "Palm oil", product_quantity: 1000, product_quantity_unit: "ml" } })

    expect((await openFoodFacts({ fetch: kilo.fetch }).lookup({ barcode: "1" }))?.fields.weight).toBe(2000)
    expect((await openFoodFacts({ fetch: litre.fetch }).lookup({ barcode: "1" }))?.fields).not.toHaveProperty("weight")
  })

  it("finds nothing for an unknown barcode, or without a barcode", async () => {
    const unknown = fakeFetch({ status: 0, status_verbose: "product not found" }, 404)

    expect(await openFoodFacts({ fetch: unknown.fetch }).lookup({ barcode: "0000000000000" })).toBeNull()
    expect(await openFoodFacts({ fetch: unknown.fetch }).lookup({ barcode: null })).toBeNull()
    expect(unknown.calls).toHaveLength(1)
  })

  it("fails loudly when the service errors, so the worker can record it", async () => {
    const down = fakeFetch({ error: "overloaded" }, 503)

    await expect(openFoodFacts({ fetch: down.fetch }).lookup({ barcode: "1" })).rejects.toThrow(/503/)
  })

  it("declares its licence: public data and images, with attribution required", () => {
    expect(openFoodFacts().policy).toMatchObject({
      public_data: true,
      image_rights: true,
      attribution: { name: "Open Food Facts", url: "https://world.openfoodfacts.org", license: "ODbL / CC BY-SA" },
    })
  })
})
