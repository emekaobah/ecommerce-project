import type { EnrichmentSource, SourceFields } from "./source"

// Open Food Facts and its sister databases share one API. Their data is ODbL and
// their images CC BY-SA, so buyers are shown a credit. This is the demo source;
// production is expected to use curated databases (docs/design.md).

type OpenFactsProduct = {
  product_name?: string
  generic_name?: string
  product_quantity?: number | string
  product_quantity_unit?: string
  image_front_url?: string
  image_url?: string
  categories_hierarchy?: string[]
}

const FIELDS = [
  "product_name",
  "generic_name",
  "product_quantity",
  "product_quantity_unit",
  "image_front_url",
  "image_url",
  "categories_hierarchy",
].join(",")

// Open Facts asks every client to name itself.
const USER_AGENT = "Oja/1.0 (catalogue enrichment)"

type Options = { fetch?: typeof globalThis.fetch }

function openFactsSource(id: string, name: string, host: string, options: Options = {}): EnrichmentSource {
  const fetch = options.fetch ?? globalThis.fetch
  const site = `https://${host}`
  return {
    id,
    name,
    policy: {
      public_data: true,
      image_rights: true,
      attribution: { name, url: site, license: "ODbL / CC BY-SA" },
      // Open Facts allows 100 product reads a minute.
      requests_per_minute: 100,
    },
    async lookup({ barcode }) {
      if (!barcode) return null
      const response = await fetch(`${site}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      })
      // An unknown barcode answers 404 with status 0.
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`${name} answered ${response.status}`)
      const body = (await response.json()) as { status?: number; product?: OpenFactsProduct }
      if (body.status !== 1 || !body.product) return null
      return { url: `${site}/product/${encodeURIComponent(barcode)}`, fields: fieldsOf(body.product) }
    },
  }
}

function fieldsOf(product: OpenFactsProduct): SourceFields {
  const fields: SourceFields = {}
  const title = product.product_name?.trim()
  if (title) fields.title = title
  const description = product.generic_name?.trim()
  if (description) fields.description = description
  const weight = grams(product.product_quantity, product.product_quantity_unit)
  if (weight) fields.weight = weight
  const image = product.image_front_url || product.image_url
  if (image) fields.image_urls = [image]
  const categories = (product.categories_hierarchy ?? []).map(categoryName).filter(Boolean).reverse()
  if (categories.length) fields.category_names = categories
  return fields
}

/** A quantity in grams; volumes (ml, l) aren't weights and give nothing. */
function grams(quantity: number | string | undefined, unit: string | undefined): number | null {
  const amount = Number(quantity)
  if (!Number.isFinite(amount) || amount <= 0) return null
  switch (unit?.trim().toLowerCase()) {
    case "g":
      return amount
    case "kg":
      return amount * 1000
    default:
      return null
  }
}

/** `en:cereals-and-their-products` → `cereals and their products`. */
const categoryName = (tag: string) => tag.replace(/^[a-z]{2}:/, "").replaceAll("-", " ").trim()

export const openFoodFacts = (options?: Options) =>
  openFactsSource("open_food_facts", "Open Food Facts", "world.openfoodfacts.org", options)
export const openBeautyFacts = (options?: Options) =>
  openFactsSource("open_beauty_facts", "Open Beauty Facts", "world.openbeautyfacts.org", options)
export const openProductsFacts = (options?: Options) =>
  openFactsSource("open_products_facts", "Open Products Facts", "world.openproductsfacts.org", options)
