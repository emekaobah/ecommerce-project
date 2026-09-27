import type { CsvTable } from "./csv"
import { importFields, type CatalogueAttribute, type ImportField, type ImportMapping } from "./fields"
import { barcodeCodes, headerUnit, parseBarcode, parseLength, parsePrice, parseWeight, type Barcode, type Parsed } from "./values"

/** What the importer checks rows against: the catalogue as it stands. */
export type ImportCatalogue = {
  /** The currency the sheet's prices are in. */
  currency_code: string
  /** The store's default sales channel, which buyers browse; imported products join it. */
  sales_channel_id?: string | null
  categories: { id: string; name: string; handle: string }[]
  attributes: CatalogueAttribute[]
  /** SKUs and barcodes (barcode, EAN and UPC) already on catalogue variants. */
  existing: { skus: string[]; barcodes: string[] }
}

type AttributeInput = { id: string; value_ids: string[] } | { id: string; value: string | boolean }

/** A row as Mercur's create-products workflow takes it: one draft product with one variant. */
export type ImportProduct = {
  title: string
  status: "draft"
  subtitle?: string
  description?: string
  handle?: string
  material?: string
  origin_country?: string
  hs_code?: string
  weight?: number
  length?: number
  width?: number
  height?: number
  thumbnail?: string
  images?: { url: string }[]
  categories?: { id: string }[]
  sales_channels?: { id: string }[]
  attributes?: AttributeInput[]
  variants: [
    {
      title: string
      sku?: string
      barcode?: string
      ean?: string
      upc?: string
      /**
       * The sheet's selling price. A master product carries no price: each shop
       * prices its own offer, and a price on the shared variant would apply to
       * every shop (#49). It is kept for the offers shops create on the product.
       */
      metadata: { import_price: { amount: number; currency_code: string } }
    },
  ]
}

export type ImportRow = {
  /** The spreadsheet line, counting the header as line 1. */
  row: number
  title: string | null
  errors: string[]
  warnings: string[]
  /** What would be created; null when the row has errors. */
  product: ImportProduct | null
}

/** Problems with the mapping itself, which stop the whole import. */
export function mappingErrors(mapping: ImportMapping, headers: string[], catalogue: Pick<ImportCatalogue, "attributes">): string[] {
  const fields = new Map(importFields(catalogue.attributes).map((f) => [f.key, f]))
  const columnsByField = new Map<string, string[]>()
  const errors: string[] = []
  for (const [column, key] of Object.entries(mapping)) {
    if (!fields.has(key)) errors.push(`"${column}" is mapped to an unknown field.`)
    else columnsByField.set(key, [...(columnsByField.get(key) ?? []), column])
  }
  for (const [key, columns] of columnsByField) {
    if (columns.length > 1) {
      const quoted = columns.map((c) => `"${c}"`).join(", ")
      errors.unshift(`${fields.get(key)!.label} is mapped from more than one column: ${quoted}.`)
    }
  }
  for (const column of Object.keys(mapping)) {
    if (!headers.includes(column)) errors.push(`The file has no column "${column}".`)
  }
  return errors
}

const TRUE = new Set(["yes", "y", "true", "1"])
const FALSE = new Set(["no", "n", "false", "0"])
const listOf = (cell: string, separator: RegExp) => cell.split(separator).map((s) => s.trim()).filter(Boolean)
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** One cell read into the value its field takes. */
function readCell(field: ImportField, column: string, cell: string, catalogue: ImportCatalogue): Parsed<unknown> {
  switch (field.kind) {
    case "barcode":
      return parseBarcode(cell)
    case "price":
      return parsePrice(cell)
    case "weight":
      return parseWeight(cell, headerUnit(column, "weight"))
    case "length":
      return parseLength(cell, headerUnit(column, "length"))
    case "category": {
      // A path such as "Groceries > Rice & Grains" names its last category.
      const name = listOf(cell, /[>/]/).pop() ?? ""
      const category = catalogue.categories.find((c) => same(c.name, name) || same(c.handle, name))
      return category ? { ok: true, value: category.id } : { ok: false, error: `No category named "${cell}".` }
    }
    case "images": {
      const urls = listOf(cell, /[\s,|;]+/)
      const bad = urls.find((u) => !/^https?:\/\/\S+$/i.test(u))
      return bad ? { ok: false, error: `"${bad}" is not a web address.` } : { ok: true, value: urls }
    }
    case "single_select":
    case "multi_select": {
      const attribute = catalogue.attributes.find((a) => `attribute:${a.id}` === field.key)!
      const names = field.kind === "multi_select" ? listOf(cell, /[|;]/) : [cell.trim()]
      const ids: string[] = []
      for (const name of names) {
        const value = attribute.values.find((v) => same(v.name, name))
        if (!value) {
          return { ok: false, error: `"${name}" is not one of: ${attribute.values.map((v) => v.name).join(", ")}.` }
        }
        ids.push(value.id)
      }
      return { ok: true, value: ids }
    }
    case "toggle": {
      const answer = cell.trim().toLowerCase()
      if (TRUE.has(answer)) return { ok: true, value: true }
      if (FALSE.has(answer)) return { ok: true, value: false }
      return { ok: false, error: `"${cell}" is not yes or no.` }
    }
    default:
      return { ok: true, value: cell.trim() }
  }
}

/**
 * Reads each data row through the mapping into a product to create, or the
 * reasons it can't be. A row needs a title or a barcode, and a selling price
 * (docs/design.md, "Minimum to create a row"); cells that can't be read, unknown
 * categories and values, and SKUs or barcodes the catalogue or an earlier row
 * already holds are errors, and a row with any error creates nothing.
 */
export function buildImportRows(table: CsvTable, mapping: ImportMapping, catalogue: ImportCatalogue): ImportRow[] {
  const fields = new Map(importFields(catalogue.attributes).map((f) => [f.key, f]))
  const columns = table.headers
    .map((header, index) => ({ header, index, field: fields.get(mapping[header]) }))
    .filter((c): c is MappedColumn => !!c.field)
  const columnOf = (key: string) => columns.find((c) => c.field.key === key)?.header ?? key
  const duplicates = duplicateChecker(catalogue.existing)

  return table.rows.map((cells, index) => {
    const row = index + 2
    const { values, errors, warnings } = readRow(cells, columns, catalogue)

    const sku = values.get("sku") as string | undefined
    const barcode = values.get("barcode") as Barcode | undefined
    const skuError = sku && duplicates.skuError(sku, row)
    if (skuError) errors.push(`${columnOf("sku")}: ${skuError}`)
    const barcodeError = barcode && duplicates.barcodeError(barcode, row)
    if (barcodeError) errors.push(`${columnOf("barcode")}: ${barcodeError}`)

    const title = (values.get("title") as string | undefined) ?? null
    if (!title && !barcode && !cellFailed(errors, columnOf("barcode"))) errors.push("Needs a title or a barcode.")
    if (!values.has("selling_price") && !cellFailed(errors, columnOf("selling_price"))) errors.push("Needs a selling price.")
    if (errors.length) return { row, title, errors, warnings, product: null }

    // Without a title the row has a barcode, which stands in for the name.
    if (!title) warnings.push("No title: the barcode stands in until the product is named.")
    const name = title ?? barcode!.barcode
    return { row, title: name, errors, warnings, product: toProduct(name, values, catalogue) }
  })
}

type MappedColumn = { header: string; index: number; field: ImportField }

/** Reads each mapped cell of a row into its field's value, collecting what couldn't be read. */
function readRow(cells: string[], columns: MappedColumn[], catalogue: ImportCatalogue) {
  const errors: string[] = []
  const warnings: string[] = []
  const values = new Map<string, unknown>()
  for (const { header, index, field } of columns) {
    const cell = cells[index]?.trim() ?? ""
    if (!cell) continue
    const parsed = readCell(field, header, cell, catalogue)
    if (!parsed.ok) {
      errors.push(`${header}: ${parsed.error}`)
      continue
    }
    if (parsed.warning) warnings.push(`${header}: ${parsed.warning}`)
    values.set(field.key, parsed.value)
  }
  return { values, errors, warnings }
}

/**
 * Refuses a SKU or barcode that is already in the catalogue or on an earlier row
 * of the file; one that isn't is remembered for the rows after it.
 */
function duplicateChecker(existing: ImportCatalogue["existing"]) {
  const existingSkus = new Set(existing.skus)
  const existingBarcodes = new Set(existing.barcodes)
  const skuRows = new Map<string, number>()
  const barcodeRows = new Map<string, number>()

  return {
    skuError(sku: string, row: number): string | undefined {
      if (existingSkus.has(sku)) return `${sku} is already in the catalogue.`
      const earlier = skuRows.get(sku)
      if (earlier !== undefined) return `${sku} is already on row ${earlier}.`
      skuRows.set(sku, row)
    },
    barcodeError(barcode: Barcode, row: number): string | undefined {
      const codes = barcodeCodes(barcode)
      if (codes.some((c) => existingBarcodes.has(c))) return `${barcode.barcode} is already in the catalogue.`
      const earlier = codes.map((c) => barcodeRows.get(c)).find((r) => r !== undefined)
      if (earlier !== undefined) return `${barcode.barcode} is already on row ${earlier}.`
      codes.forEach((c) => barcodeRows.set(c, row))
    },
  }
}

/** Whether a column's cell already failed to read, so its field isn't also reported missing. */
const cellFailed = (errors: string[], column: string) => errors.some((e) => e.startsWith(`${column}:`))

const PRODUCT_TEXT = ["subtitle", "description", "handle", "material", "origin_country", "hs_code"] as const
const DIMENSIONS = ["weight", "length", "width", "height"] as const

function toProduct(title: string, values: Map<string, unknown>, catalogue: ImportCatalogue): ImportProduct {
  const barcode = values.get("barcode") as Barcode | undefined
  const sku = values.get("sku") as string | undefined
  const images = values.get("images") as string[] | undefined
  const category = values.get("category") as string | undefined
  const attributes: AttributeInput[] = catalogue.attributes
    .filter((a) => values.has(`attribute:${a.id}`))
    .map((a) => {
      const value = values.get(`attribute:${a.id}`) as string | boolean | string[]
      return Array.isArray(value) ? { id: a.id, value_ids: value } : { id: a.id, value }
    })

  const product: ImportProduct = {
    title,
    status: "draft",
    variants: [
      {
        title,
        ...(sku && { sku }),
        ...barcode,
        metadata: {
          import_price: { amount: values.get("selling_price") as number, currency_code: catalogue.currency_code },
        },
      },
    ],
  }
  for (const key of PRODUCT_TEXT) {
    if (values.has(key)) product[key] = values.get(key) as string
  }
  for (const key of DIMENSIONS) {
    if (values.has(key)) product[key] = values.get(key) as number
  }
  if (images?.length) {
    product.thumbnail = images[0]
    product.images = images.map((url) => ({ url }))
  }
  if (category) product.categories = [{ id: category }]
  if (catalogue.sales_channel_id) product.sales_channels = [{ id: catalogue.sales_channel_id }]
  if (attributes.length) product.attributes = attributes
  return product
}
