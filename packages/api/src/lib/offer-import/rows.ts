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
  /** The shop's own offers, as a re-import finds and compares them. */
  offers: ShopOffer[]
}

/** One of the shop's offers, as it stands. */
export type ShopOffer = {
  id: string
  sku: string
  variant_id: string
  /** The product's title. */
  title: string
  /** Its selling price in the sheet's currency, if it has one. */
  price: number | null
  /** Its private cost price, if the shop gave one. */
  cost: number | null
  /** Units in stock; null when the offer isn't tracked. */
  stock: number | null
}

/** What a re-import changes on an offer the shop already has; null leaves a field as it is. */
export type OfferUpdate = {
  offer_id: string
  price: number | null
  cost: number | null
  stock: number | null
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
  /**
   * `offer`: list a catalogue product; `propose`: propose a new product and offer
   * it; `update`: change an offer the shop already has; `unchanged`: the shop's
   * offer already matches the row; null: the row has errors.
   */
  action: "offer" | "propose" | "update" | "unchanged" | null
  errors: string[]
  warnings: string[]
  /** A new offer. */
  offer: ImportOffer | null
  proposal: ProposedProduct | null
  /** What an update changes, said for the shop ("Price NGN 1,400 → NGN 1,500"). */
  changes: string[]
  update: OfferUpdate | null
}

type MappedColumn = { header: string; index: number; field: OfferImportField }
type Values = Map<string, unknown>

const STOCK_UNITS = new Set(["", "pc", "pcs", "piece", "pieces", "unit", "units", "ea", "ctn", "ctns", "carton", "cartons"])

/** "1,200" or "1200", but not "12,00" or ",5": thousands groups of three after a first group of one to three. */
const wholeNumber = (text: string) => {
  const [first, ...groups] = text.split(",")
  const digits = (part: string) => part !== "" && [...part].every((c) => c >= "0" && c <= "9")
  if (!groups.length) return digits(first)
  return digits(first) && first.length <= 3 && groups.every((g) => g.length === 3 && digits(g))
}

/** A stock count: "12", "1,200", "12 pcs". */
export function parseStock(input: string): Parsed<number> {
  const text = input.trim()
  // Disjoint character classes, so this reads a long cell in one pass.
  const [, number = "", unit = ""] = /^([\d,]+)\s*([a-z]*)\.?$/i.exec(text) ?? []
  if (!wholeNumber(number) || !STOCK_UNITS.has(unit.toLowerCase())) {
    return { ok: false, error: `"${text}" is not a stock count: use a whole number of units.` }
  }
  return { ok: true, value: Number(number.replaceAll(",", "")) }
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

/** Drops the dash, if any, at each end; runs of dashes were already collapsed to one. */
const trimDash = (text: string) => text.slice(text.startsWith("-") ? 1 : 0, text.endsWith("-") ? -1 : undefined)

/**
 * "Kilishi (200g)" → "KILISHI-200G": a SKU for a row that brought none. Trimmed
 * without an anchored `-+$` pattern, which backtracks on long uploaded cells.
 */
const skuFrom = (text: string) => trimDash(trimDash(text.toUpperCase().replace(/[^A-Z0-9]+/g, "-")).slice(0, 40))

/**
 * Reads each row of a shop's sheet into what the import would do with it.
 *
 * - A row for an offer the shop already has (its barcode's product, or, with no
 *   barcode, its SKU) updates that offer's price, cost and stock with whatever
 *   the row gives; anything it leaves out stays as it is.
 * - A row whose barcode a published catalogue product carries becomes the shop's
 *   new offer on it.
 * - Any other row proposes a new product, carrying whatever the sheet had, and
 *   offers it. A new offer needs a barcode or a title, and a selling price
 *   (docs/design.md, "Minimum to create a row").
 */
export function buildOfferImportRows(table: CsvTable, mapping: ImportMapping, context: OfferImportContext): OfferImportRow[] {
  const columns = table.headers
    .map((header, index) => ({ header, index, field: offerImportField(mapping[header]) }))
    .filter((c): c is MappedColumn => !!c.field)
  const sheet: SheetState = {
    context,
    columnOf: (key: string) => columns.find((c) => c.field.key === key)?.header ?? key,
    codes: codeChecker(context),
    updatedRows: new Map(),
  }
  const variantByCode = new Map(context.variants.flatMap((v) => v.codes.map((c) => [c, v] as const)))
  const offerByVariant = new Map(context.offers.map((o) => [o.variant_id, o]))
  const offerBySku = new Map(context.offers.map((o) => [o.sku, o]))

  return table.rows.map((cells, index) => {
    const read = { row: index + 2, ...readRow(cells, columns, context) }
    const barcode = read.values.get("barcode") as Barcode | undefined
    const given = read.values.get("sku") as string | undefined
    const title = read.values.get("title") as string | undefined
    const match = barcode ? barcodeCodes(barcode).map((c) => variantByCode.get(c)).find(Boolean) : undefined
    // A barcode names the product. A row without one is found by its SKU, or by
    // the SKU an earlier import made from its title, so it isn't proposed twice.
    const sku = given ?? (title ? skuFrom(title) : undefined)
    let existing: ShopOffer | undefined
    if (match) existing = offerByVariant.get(match.id)
    else if (!barcode && sku) existing = offerBySku.get(sku)
    return existing ? updateRow(read, existing, sheet) : newOfferRow(read, match, sheet)
  })
}

type RowRead = { row: number; values: Values; errors: string[]; warnings: string[] }

/** What reading one row needs from the sheet as a whole. */
type SheetState = {
  context: OfferImportContext
  columnOf: (key: string) => string
  codes: ReturnType<typeof codeChecker>
  /** The row that updates each offer, so no two rows update one. */
  updatedRows: Map<string, number>
}

const failed = ({ row, errors, warnings }: Pick<RowRead, "row" | "errors" | "warnings">, title: string | null): OfferImportRow => ({
  row,
  title,
  action: null,
  errors,
  warnings,
  offer: null,
  proposal: null,
  changes: [],
  update: null,
})

const belowCost = (price: number, cost: number, currency: string) =>
  `Selling price ${money(price, currency)} is below cost price ${money(cost, currency)}.`

/** A row for an offer the shop already has: what it changes, leaving what it doesn't give. */
function updateRow(read: RowRead, existing: ShopOffer, sheet: SheetState): OfferImportRow {
  const { row, values, errors, warnings } = read
  checkUpdate(read, existing, sheet)
  if (errors.length) return failed(read, existing.title)
  sheet.updatedRows.set(existing.id, row)
  const barcode = values.get("barcode") as Barcode | undefined
  if (barcode) sheet.codes.claimBarcode(barcode, row)

  const { update, changes, warning } = describeUpdate(existing, values, sheet.context.currency_code)
  if (warning) warnings.push(warning)
  return {
    row,
    title: existing.title,
    action: changes.length ? "update" : "unchanged",
    errors,
    warnings,
    offer: null,
    proposal: null,
    changes,
    update,
  }
}

/** Refuses an update row whose barcode or SKU another row or offer has, or whose offer an earlier row updates. */
function checkUpdate({ values, errors, warnings }: RowRead, existing: ShopOffer, { codes, columnOf, updatedRows }: SheetState) {
  const barcode = values.get("barcode") as Barcode | undefined
  const given = values.get("sku") as string | undefined
  const repeated = barcode && codes.barcodeError(barcode)
  if (repeated) errors.push(`${columnOf("barcode")}: ${repeated}`)
  if (given && given !== existing.sku) {
    const taken = codes.skuError(given)
    if (taken) errors.push(`${columnOf("sku")}: ${taken}`)
    else warnings.push(`${columnOf("sku")}: SKUs aren't changed by an import; this offer keeps ${existing.sku}.`)
  }
  const earlier = updatedRows.get(existing.id)
  if (earlier !== undefined) errors.push(`${existing.title} is already updated on row ${earlier}.`)
}

/** What a row changes on the offer, said for the shop, and a warning if it leaves the offer selling below cost. */
function describeUpdate(existing: ShopOffer, values: Values, currency: string) {
  const changed = (key: string, current: number | null) => {
    const next = values.get(key) as number | undefined
    return next === undefined || next === current ? null : next
  }
  const update: OfferUpdate = {
    offer_id: existing.id,
    price: changed("selling_price", existing.price),
    cost: changed("cost_price", existing.cost),
    stock: changed("stock", existing.stock),
  }
  const was = (amount: number | null) => (amount === null ? "none" : money(amount, currency))
  const stockWas = existing.stock ?? "not tracked"
  const changes = [
    update.price === null ? null : `Price ${was(existing.price)} → ${money(update.price, currency)}`,
    update.cost === null ? null : `Cost price ${was(existing.cost)} → ${money(update.cost, currency)}`,
    // Stock left out of the sheet leaves the offer as it is: untracked stays untracked.
    update.stock === null ? null : `Stock ${stockWas} → ${update.stock}`,
  ].filter((c): c is string => c !== null)

  const price = update.price ?? existing.price
  const cost = update.cost ?? existing.cost
  const pricing = update.price !== null || update.cost !== null
  const below = pricing && price !== null && cost !== null && price < cost
  return { update, changes, warning: below ? belowCost(price, cost, currency) : null }
}

/**
 * Refuses a new-offer row without the minimum (a barcode or a title, and a
 * price), with a barcode or SKU another row or offer has, or on a product the
 * catalogue is still reviewing.
 */
function checkNewOffer({ values, errors }: RowRead, match: CatalogueVariant | undefined, { codes, columnOf }: SheetState) {
  const barcode = values.get("barcode") as Barcode | undefined
  const given = values.get("sku") as string | undefined
  const missing = (field: string) => !values.has(field) && !cellFailed(errors, columnOf(field))
  if (!values.has("title") && missing("barcode")) errors.push("Needs a title or a barcode.")
  if (missing("selling_price")) errors.push("Needs a selling price.")
  const repeated = barcode && codes.barcodeError(barcode)
  if (repeated) errors.push(`${columnOf("barcode")}: ${repeated}`)
  if (match && !match.published) {
    errors.push(
      `${columnOf("barcode")}: ${barcode!.barcode} is on a product the catalogue is still reviewing; list it once it is published.`
    )
  }
  const skuError = given && codes.skuError(given)
  if (skuError) errors.push(`${columnOf("sku")}: ${skuError}`)
}

/** A row for something the shop doesn't sell yet: an offer on the catalogue's product, or a proposal. */
function newOfferRow(read: RowRead, match: CatalogueVariant | undefined, sheet: SheetState): OfferImportRow {
  const { row, values, errors, warnings } = read
  const { codes, context } = sheet
  const barcode = values.get("barcode") as Barcode | undefined
  const title = (values.get("title") as string | undefined) ?? null
  const price = values.get("selling_price") as number | undefined
  const cost = (values.get("cost_price") as number | undefined) ?? null
  const stock = (values.get("stock") as number | undefined) ?? null
  const given = values.get("sku") as string | undefined

  checkNewOffer(read, match, sheet)
  if (errors.length || price === undefined) return failed(read, title)

  const sku = given ?? codes.freeSku(barcode?.barcode ?? skuFrom(title ?? ""))
  codes.claimSku(sku, row)
  if (barcode) codes.claimBarcode(barcode, row)
  // Cost is the shop's own business; a sale below it is allowed, but never by accident.
  if (cost !== null && price < cost) warnings.push(belowCost(price, cost, context.currency_code))
  const offer = { sku, price, cost, stock }
  const created = { row, errors, warnings, changes: [], update: null }

  if (match) {
    return {
      ...created,
      title: match.title,
      action: "offer",
      offer: { variant_id: match.id, product_id: match.product_id, ...offer },
      proposal: null,
    }
  }
  // Without a title the row has a barcode, which stands in until enrichment names the product.
  if (!title) warnings.push("No title: the barcode stands in until the product is named.")
  const name = title ?? barcode!.barcode
  return {
    ...created,
    title: name,
    action: "propose",
    offer: { variant_id: null, product_id: null, ...offer },
    proposal: toProposal(name, values),
  }
}

/**
 * Reads the sheet for the member importing it. One who may not price the shop's
 * offers neither sees nor sets costs, and can't change offers the shop already
 * has; they may still add new ones.
 */
export function readOfferImportRows(
  table: CsvTable,
  mapping: ImportMapping,
  context: OfferImportContext,
  member: { may_price: boolean }
): OfferImportRow[] {
  if (member.may_price) return buildOfferImportRows(table, mapping, context)
  const restricted = withoutCosts(mapping, context)
  return refuseUpdates(buildOfferImportRows(table, restricted.mapping, restricted.context))
}

/**
 * The sheet as a member who may not price offers reads it: the cost column is
 * left unread and the shop's costs unknown, so neither shows in any row or
 * warning.
 */
export function withoutCosts(mapping: ImportMapping, context: OfferImportContext) {
  return {
    mapping: Object.fromEntries(Object.entries(mapping).filter(([, field]) => field !== "cost_price")),
    context: { ...context, offers: context.offers.map((o) => ({ ...o, cost: null })) },
  }
}

/** Rows as a member who may not price offers may import them: none changes an offer the shop already has. */
export function refuseUpdates(rows: OfferImportRow[]): OfferImportRow[] {
  return rows.map((row) =>
    row.action === "update"
      ? failed({ row: row.row, errors: ["Only owners and managers can change offers the shop already sells."], warnings: row.warnings }, row.title)
      : row
  )
}

/** Whether a column's cell already failed to read, so its field isn't also reported missing. */
const cellFailed = (errors: string[], column: string) => errors.some((e) => e.startsWith(`${column}:`))

/**
 * Keeps the sheet's SKUs and barcodes apart from the shop's offers and from each
 * other. A SKU the sheet gave is refused if taken; one made up for a row is
 * numbered until it is free. Only rows that will be imported claim their codes.
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
      const taken = (sku: string) => shopSkus.has(sku) || skuRows.has(sku)
      if (!taken(base)) return base
      let n = 2
      while (taken(`${base}-${n}`)) n++
      return `${base}-${n}`
    },
    claimSku(sku: string, row: number) {
      skuRows.set(sku, row)
    },
    barcodeError(barcode: Barcode): string | undefined {
      const earlier = barcodeCodes(barcode)
        .map((c) => barcodeRows.get(c))
        .find((r) => r !== undefined)
      if (earlier !== undefined) return `${barcode.barcode} is already on row ${earlier}.`
    },
    claimBarcode(barcode: Barcode, row: number) {
      barcodeCodes(barcode).forEach((c) => barcodeRows.set(c, row))
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
