import type { FieldKind, ImportField, ImportMapping } from "../catalogue-import"

/**
 * What a column of a shop's product list can be mapped to: the product fields a
 * proposal carries, the barcode that finds a catalogue product, and the offer's
 * own fields. Catalogue attributes aren't offered: a shop's proposal goes to
 * review, where enrichment and the operator fill them in.
 */
export type OfferImportField = Omit<ImportField, "kind" | "group"> & {
  group: "product" | "variant" | "offer"
  kind: FieldKind | "stock"
}

export const OFFER_IMPORT_FIELDS: OfferImportField[] = [
  { key: "title", label: "Title", group: "product", kind: "text", aliases: ["title", "name", "product name", "product title", "product", "item", "item name"] },
  { key: "description", label: "Description", group: "product", kind: "text", aliases: ["description", "product description", "details"] },
  { key: "category", label: "Category", group: "product", kind: "category", aliases: ["category", "categories", "product category", "department"] },
  { key: "images", label: "Image URLs", group: "product", kind: "images", aliases: ["image", "images", "image url", "image urls", "photo", "picture"] },
  { key: "weight", label: "Weight", group: "product", kind: "weight", aliases: ["weight", "net weight", "gross weight", "shipping weight"] },
  {
    key: "barcode",
    label: "Barcode (GTIN, EAN, UPC, ISBN)",
    group: "variant",
    kind: "barcode",
    aliases: ["barcode", "gtin", "ean", "upc", "isbn", "ean13", "upc a", "gtin 13", "gtin 14", "bar code"],
  },
  { key: "sku", label: "Your SKU", group: "offer", kind: "text", aliases: ["sku", "item code", "product code", "article number", "code"] },
  {
    key: "selling_price",
    label: "Selling price",
    group: "offer",
    kind: "price",
    // Shops often head their selling price "Sale price" (the price they sell at), so it reads as
    // that; a discount is suggested only from a header that can't mean anything else (#46).
    aliases: [
      "price",
      "selling price",
      "sale price",
      "sales price",
      "selling sale price",
      "retail price",
      "unit price",
      "rrp",
      "amount",
      "regular price",
    ],
  },
  {
    key: "sale_price",
    label: "Discount (sale) price",
    group: "offer",
    kind: "price",
    aliases: ["discount price", "discounted price", "promo price", "promotional price"],
  },
  {
    key: "cost_price",
    label: "Cost price (private)",
    group: "offer",
    kind: "price",
    aliases: ["cost", "cost price", "unit cost", "buying price", "purchase price", "wholesale price", "cost of goods"],
  },
  { key: "stock", label: "Stock", group: "offer", kind: "stock", aliases: ["stock", "quantity", "qty", "in stock", "stock level", "inventory", "on hand"] },
]

const FIELD_KEYS = new Map(OFFER_IMPORT_FIELDS.map((f) => [f.key, f]))

export const offerImportField = (key: string) => FIELD_KEYS.get(key)

/** Problems with the mapping itself, which stop the whole import. */
export function offerMappingErrors(mapping: ImportMapping, headers: string[]): string[] {
  const errors: string[] = []
  const columnsByField = new Map<string, string[]>()
  for (const [column, key] of Object.entries(mapping)) {
    if (!FIELD_KEYS.has(key)) errors.push(`"${column}" is mapped to an unknown field.`)
    else columnsByField.set(key, [...(columnsByField.get(key) ?? []), column])
    if (!headers.includes(column)) errors.push(`The file has no column "${column}".`)
  }
  for (const [key, columns] of columnsByField) {
    if (columns.length > 1) {
      const quoted = columns.map((c) => `"${c}"`).join(", ")
      errors.unshift(`${FIELD_KEYS.get(key)!.label} is mapped from more than one column: ${quoted}.`)
    }
  }
  return errors
}
