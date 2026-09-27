/**
 * What a catalogue spreadsheet's columns can be mapped to: product and variant
 * fields, the offer's selling price, and the catalogue's global attributes.
 */

/** A global attribute as the importer needs it. */
export type CatalogueAttribute = {
  id: string
  name: string
  handle: string
  type: "single_select" | "multi_select" | "text" | "unit" | "toggle"
  is_variant_axis: boolean
  values: { id: string; name: string }[]
}

export type FieldKind =
  | "text"
  | "barcode"
  | "weight"
  | "length"
  | "price"
  | "category"
  | "images"
  | CatalogueAttribute["type"]

export type ImportField = {
  /** `title`, `barcode`, … or `attribute:<id>`. */
  key: string
  label: string
  group: "product" | "variant" | "offer" | "attribute"
  kind: FieldKind
  /** Header names that suggest this field, normalised (see `normaliseHeader`). */
  aliases: string[]
  /** A select attribute's allowed values, for the operator's reference. */
  values?: string[]
}

/** Column name → field key. Unmapped columns are left out. */
export type ImportMapping = Record<string, string>

const CORE_FIELDS: ImportField[] = [
  { key: "title", label: "Title", group: "product", kind: "text", aliases: ["title", "name", "product name", "product title", "product"] },
  { key: "subtitle", label: "Subtitle", group: "product", kind: "text", aliases: ["subtitle"] },
  { key: "description", label: "Description", group: "product", kind: "text", aliases: ["description", "product description", "details"] },
  { key: "handle", label: "Handle", group: "product", kind: "text", aliases: ["handle", "slug"] },
  { key: "category", label: "Category", group: "product", kind: "category", aliases: ["category", "categories", "product category", "department"] },
  { key: "images", label: "Image URLs", group: "product", kind: "images", aliases: ["image", "images", "image url", "image urls", "photo", "picture"] },
  { key: "weight", label: "Weight", group: "product", kind: "weight", aliases: ["weight", "net weight", "gross weight", "shipping weight"] },
  { key: "length", label: "Length", group: "product", kind: "length", aliases: ["length", "depth"] },
  { key: "width", label: "Width", group: "product", kind: "length", aliases: ["width"] },
  { key: "height", label: "Height", group: "product", kind: "length", aliases: ["height"] },
  { key: "material", label: "Material", group: "product", kind: "text", aliases: ["material"] },
  { key: "origin_country", label: "Country of origin", group: "product", kind: "text", aliases: ["origin country", "country of origin", "origin"] },
  { key: "hs_code", label: "HS code", group: "product", kind: "text", aliases: ["hs code", "hs", "tariff code"] },
  { key: "sku", label: "SKU", group: "variant", kind: "text", aliases: ["sku", "item code", "product code", "article number"] },
  {
    key: "barcode",
    label: "Barcode (GTIN, EAN, UPC, ISBN, ASIN)",
    group: "variant",
    kind: "barcode",
    aliases: ["barcode", "gtin", "ean", "upc", "isbn", "asin", "ean13", "upc a", "gtin 13", "gtin 14"],
  },
  {
    key: "selling_price",
    label: "Selling price",
    group: "offer",
    kind: "price",
    aliases: ["price", "selling price", "retail price", "sale price", "unit price", "rrp", "amount"],
  },
]

/**
 * The fields a column can map to. Variant-axis attributes are left out: they
 * generate variants, and each import row is one single-variant product.
 */
export function importFields(attributes: CatalogueAttribute[]): ImportField[] {
  return [
    ...CORE_FIELDS,
    ...attributes
      .filter((a) => !a.is_variant_axis)
      .map((a) => ({
        key: `attribute:${a.id}`,
        label: a.name,
        group: "attribute" as const,
        kind: a.type,
        aliases: [normaliseHeader(a.name), normaliseHeader(a.handle)],
        ...(a.values.length && { values: a.values.map((v) => v.name) }),
      })),
  ]
}

/** "Retail price (₦)" → "retail price": lower case, no bracketed unit, words only. */
export function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    // Stops at the next bracket, so unclosed ones in an uploaded header stay linear.
    .replace(/\([^()]*\)|\[[^[\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** A first mapping for a file never imported before: each field to the first column whose name matches it. */
export function suggestMapping(headers: string[], fields: ImportField[]): ImportMapping {
  const mapping: ImportMapping = {}
  const taken = new Set<string>()
  for (const header of headers) {
    const name = normaliseHeader(header)
    const field = fields.find((f) => !taken.has(f.key) && f.aliases.includes(name))
    if (!field) continue
    mapping[header] = field.key
    taken.add(field.key)
  }
  return mapping
}
