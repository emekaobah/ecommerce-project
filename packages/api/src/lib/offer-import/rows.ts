import {
  barcodeCodes,
  readCell,
  type Barcode,
  type CsvTable,
  type ImportField,
  type ImportMapping,
  type Parsed,
} from "../catalogue-import"
import { offerImportField, type OfferImportField } from "./fields"

/** A catalogue variant a row's barcode can match. */
export type CatalogueVariant = {
  id: string
  product_id: string
  /** The product's title, which the shop's offer is sold under. */
  title: string
  /** Only published products take offers; others are still being reviewed. */
  published: boolean
  /** Its barcode, EAN and UPC. */
  codes: string[]
}

/** What a shop's sheet is read against. */
export type OfferImportContext = {
  /** The currency the sheet's prices are in. */
  currency_code: string
  categories: { id: string; name: string; handle: string }[]
  /** Catalogue variants carrying any of the sheet's barcodes. */
  variants: CatalogueVariant[]
  /** The shop's own offers. */
  offers: { sku: string; variant_id: string }[]
}

export type ImportOffer = {
  /** The catalogue variant offered; null until a proposal's product exists. */
  variant_id: string | null
  product_id: string | null
  sku: string
  /** Selling price, in major units. */
  price: number
  /** The shop's private cost price, in major units. */
  cost: number | null
  /** Units in stock; null when the sheet doesn't track stock. */
  stock: number | null
}

/** A product the shop proposes to the catalogue: whatever its sheet had, one variant. */
export type ProposedProduct = {
  title: string
  description?: string
  weight?: number
  thumbnail?: string
  images?: { url: string }[]
  categories?: { id: string }[]
  variants: [{ title: string; barcode?: string; ean?: string; upc?: string }]
}

export type OfferImportRow = {
  /** The spreadsheet line, counting the header as line 1. */
  row: number
  title: string | null
  /** `offer`: list a catalogue product; `propose`: propose a new product and offer it; null: the row has errors. */
  action: "offer" | "propose" | null
  errors: string[]
  warnings: string[]
  offer: ImportOffer | null
  proposal: ProposedProduct | null
}

type MappedColumn = { header: string; index: number; field: OfferImportField }
type Values = Map<string, unknown>

/** A stock count: "12", "1,200", "12 pcs". */
export function parseStock(input: string): Parsed<number> {
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)\s*(?:pcs?|pieces?|units?|ea|ctns?|cartons?)?\.?$/i.exec(input.trim())
  if (!match) return { ok: false, error: `"${input.trim()}" is not a stock count: use a whole number of units.` }
  return { ok: true, value: Number(match[1].replaceAll(",", "")) }
}

const money = (amount: number, currency: string) =>
  `${currency.toUpperCase()} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`

function readField(field: OfferImportField, column: string, cell: string, context: OfferImportContext): Parsed<unknown> {
  if (field.kind === "stock") return parseStock(cell)
  return readCell(field as ImportField, column, cell, { categories: context.categories, attributes: [] })
}

/** Reads each mapped cell of a row into its field's value, collecting what couldn't be read. */
function readRow(cells: string[], columns: MappedColumn[], context: OfferImportContext) {
  const errors: string[] = []
  const warnings: string[] = []
  const values: Values = new Map()
  for (const { header, index, field } of columns) {
    const cell = cells[index]?.trim() ?? ""
    if (!cell) continue
    const parsed = readField(field, header, cell, context)
    if (!parsed.ok) {
      errors.push(`${header}: ${parsed.error}`)
      continue
    }
    if (parsed.warning) warnings.push(`${header}: ${parsed.warning}`)
    values.set(field.key, parsed.value)
  }
  return { values, errors, warnings }
}

/** "Kilishi (200g)" → "KILISHI-200G": a SKU for a row that brought none. */
const skuFrom = (text: string) =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)

/**
 * Reads each row of a shop's sheet into what the import would do with it. A row
 * whose barcode a published catalogue product carries becomes the shop's offer
 * on it; any other row proposes a new product, carrying whatever the sheet had,
 * and offers it. A row needs a barcode or a title, and a selling price
 * (docs/design.md, "Minimum to create a row").
 */
export function buildOfferImportRows(table: CsvTable, mapping: ImportMapping, context: OfferImportContext): OfferImportRow[] {
  const columns = table.headers
    .map((header, index) => ({ header, index, field: offerImportField(mapping[header]) }))
    .filter((c): c is MappedColumn => !!c.field)
  const columnOf = (key: string) => columns.find((c) => c.field.key === key)?.header ?? key
  const variantByCode = new Map(context.variants.flatMap((v) => v.codes.map((c) => [c, v] as const)))
  const offerByVariant = new Map(context.offers.map((o) => [o.variant_id, o]))
  const codes = codeChecker(context)

  return table.rows.map((cells, index) => {
    const row = index + 2
    const { values, errors, warnings } = readRow(cells, columns, context)
    const barcode = values.get("barcode") as Barcode | undefined
    const title = (values.get("title") as string | undefined) ?? null
    const price = values.get("selling_price") as number | undefined
    const cost = (values.get("cost_price") as number | undefined) ?? null
    const stock = (values.get("stock") as number | undefined) ?? null

    if (!title && !barcode && !cellFailed(errors, columnOf("barcode"))) errors.push("Needs a title or a barcode.")
    if (price === undefined && !cellFailed(errors, columnOf("selling_price"))) errors.push("Needs a selling price.")

    const match = barcode && barcodeCodes(barcode).map((c) => variantByCode.get(c)).find(Boolean)
    if (barcode) {
      const repeated = codes.barcodeError(barcode, row)
      if (repeated) errors.push(`${columnOf("barcode")}: ${repeated}`)
    }
    const existing = match && offerByVariant.get(match.id)
    if (existing) errors.push(`You already sell ${match.title}, as ${existing.sku}.`)
    else if (match && !match.published) {
      errors.push(
        `${columnOf("barcode")}: ${barcode!.barcode} is on a product the catalogue is still reviewing; list it once it is published.`
      )
    }

    const given = values.get("sku") as string | undefined
    const skuError = given && codes.skuError(given)
    if (skuError) errors.push(`${columnOf("sku")}: ${skuError}`)
    if (errors.length || price === undefined) return { row, title, action: null, errors, warnings, offer: null, proposal: null }
    const sku = given ?? codes.freeSku(barcode?.barcode ?? skuFrom(title ?? ""))
    codes.claimSku(sku, row)

    // Cost is the shop's own business; a sale below it is allowed, but never by accident.
    if (cost !== null && price < cost) {
      warnings.push(
        `Selling price ${money(price, context.currency_code)} is below cost price ${money(cost, context.currency_code)}.`
      )
    }
    const offer = { sku, price, cost, stock }

    if (match) {
      return {
        row,
        title: match.title,
        action: "offer",
        errors,
        warnings,
        offer: { variant_id: match.id, product_id: match.product_id, ...offer },
        proposal: null,
      }
    }
    // Without a title the row has a barcode, which stands in until enrichment names the product.
    if (!title) warnings.push("No title: the barcode stands in until the product is named.")
    const name = title ?? barcode!.barcode
    return {
      row,
      title: name,
      action: "propose",
      errors,
      warnings,
      offer: { variant_id: null, product_id: null, ...offer },
      proposal: toProposal(name, values),
    }
  })
}

/** Whether a column's cell already failed to read, so its field isn't also reported missing. */
const cellFailed = (errors: string[], column: string) => errors.some((e) => e.startsWith(`${column}:`))

/**
 * Keeps the sheet's SKUs and barcodes apart from the shop's offers and from each
 * other. A SKU the sheet gave is refused if taken; one made up for a row is
 * numbered until it is free.
 */
function codeChecker(context: OfferImportContext) {
  const shopSkus = new Set(context.offers.map((o) => o.sku))
  const skuRows = new Map<string, number>()
  const barcodeRows = new Map<string, number>()
  return {
    skuError(sku: string): string | undefined {
      if (shopSkus.has(sku)) return `You already use ${sku} for another offer.`
      const earlier = skuRows.get(sku)
      if (earlier !== undefined) return `${sku} is already on row ${earlier}.`
    },
    freeSku(base: string): string {
      let sku = base
      for (let n = 2; shopSkus.has(sku) || skuRows.has(sku); n++) sku = `${base}-${n}`
      return sku
    },
    claimSku(sku: string, row: number) {
      skuRows.set(sku, row)
    },
    barcodeError(barcode: Barcode, row: number): string | undefined {
      const all = barcodeCodes(barcode)
      const earlier = all.map((c) => barcodeRows.get(c)).find((r) => r !== undefined)
      if (earlier !== undefined) return `${barcode.barcode} is already on row ${earlier}.`
      all.forEach((c) => barcodeRows.set(c, row))
    },
  }
}

function toProposal(title: string, values: Values): ProposedProduct {
  const barcode = values.get("barcode") as Barcode | undefined
  const images = values.get("images") as string[] | undefined
  const category = values.get("category") as string | undefined
  const proposal: ProposedProduct = { title, variants: [{ title, ...barcode }] }
  if (values.has("description")) proposal.description = values.get("description") as string
  if (values.has("weight")) proposal.weight = values.get("weight") as number
  if (category) proposal.categories = [{ id: category }]
  if (images?.length) {
    proposal.thumbnail = images[0]
    proposal.images = images.map((url) => ({ url }))
  }
  return proposal
}
