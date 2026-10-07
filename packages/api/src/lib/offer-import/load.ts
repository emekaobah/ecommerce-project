import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules, ProductStatus } from "@medusajs/framework/utils"
import { barcodeCodes, parseBarcode, type CsvTable, type ImportMapping } from "../catalogue-import"
import { OFFER_IMPORT_MODULE, type OfferImportModuleService } from "../../modules/offer-import"
import type { OfferPriceInput } from "../../workflows/offer-prices/steps"
import type { UpdateImportedOfferInput } from "../../workflows/offer-import/update-imported-offer"
import type { CatalogueVariant, OfferImportContext, OfferUpdate, ShopOffer } from "./rows"

type Scope = Pick<MedusaContainer, "resolve">

export const offerImportService = (scope: Scope) => scope.resolve<OfferImportModuleService>(OFFER_IMPORT_MODULE)

/** Where a shop's imported offers ship from and are stocked, and the channel its proposals join. */
export type ShopSetup = {
  currency_code: string
  sales_channel_id: string | null
  /** The shop's stock location, where imported stock is counted; null if it has none. */
  stock_location_id: string | null
  /** The shipping profile the shop's offers use. */
  shipping_profile_id: string | null
}

/** The barcodes a sheet's barcode column holds, read the way rows read them. */
function sheetBarcodes(table: CsvTable, mapping: ImportMapping): string[] {
  const column = Object.keys(mapping).find((c) => mapping[c] === "barcode")
  const index = column ? table.headers.indexOf(column) : -1
  if (index < 0) return []
  return table.rows.flatMap((cells) => {
    const parsed = cells[index] ? parseBarcode(cells[index]) : null
    return parsed?.ok ? barcodeCodes(parsed.value) : []
  })
}

type VariantRow = {
  id: string
  product_id: string
  barcode: string | null
  ean: string | null
  upc: string | null
  product: { title: string; status: string } | null
}

/** What the shop's sheet is read against: catalogue variants with its barcodes, and the shop's own offers. */
export async function loadOfferImportContext(
  scope: Scope,
  sellerId: string,
  table: CsvTable,
  mapping: ImportMapping,
  setup: ShopSetup
): Promise<OfferImportContext> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const codes = [...new Set(sheetBarcodes(table, mapping))]
  const [{ data: categories }, variants, offers] = await Promise.all([
    query.graph({ entity: "product_category", fields: ["id", "name", "handle"] }),
    loadVariantsByCode(scope, codes),
    loadShopOffers(scope, sellerId, setup),
  ])
  return {
    currency_code: setup.currency_code,
    categories: categories as OfferImportContext["categories"],
    variants,
    offers,
  }
}

/** Catalogue variants whose barcode, EAN or UPC is one of the codes. */
async function loadVariantsByCode(scope: Scope, codes: string[]): Promise<CatalogueVariant[]> {
  if (!codes.length) return []
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const fields = ["id", "product_id", "barcode", "ean", "upc", "product.title", "product.status"]
  const found = await Promise.all(
    (["barcode", "ean", "upc"] as const).map((field) =>
      query.graph({ entity: "product_variant", fields, filters: { [field]: codes } })
    )
  )
  const byId = new Map(found.flatMap(({ data }) => (data as VariantRow[]).map((v) => [v.id, v] as const)))
  return [...byId.values()].map((v) => ({
    id: v.id,
    product_id: v.product_id,
    title: v.product?.title ?? "",
    published: v.product?.status === ProductStatus.PUBLISHED,
    codes: barcodeCodes(v),
  }))
}

type OfferRow = {
  id: string
  sku: string
  variant_id: string
  product_id: string
  manage_inventory: boolean
  prices?: (OfferPrice | null)[] | null
  inventory_items?: { id: string; location_levels?: { location_id: string; stocked_quantity: number }[] | null }[] | null
}

type OfferPrice = {
  id: string
  amount: number
  currency_code: string
  min_quantity: number | null
  max_quantity: number | null
  price_rules?: { attribute: string; value: string }[] | null
}

const OFFER_FIELDS = [
  "id",
  "sku",
  "variant_id",
  "product_id",
  "manage_inventory",
  "prices.id",
  "prices.amount",
  "prices.currency_code",
  "prices.min_quantity",
  "prices.max_quantity",
  "prices.price_rules.attribute",
  "prices.price_rules.value",
  "inventory_items.id",
  "inventory_items.location_levels.location_id",
  "inventory_items.location_levels.stocked_quantity",
]

/** An offer's everyday selling price in the currency: the one without quantity tiers. */
const basePrice = (offer: OfferRow, currency: string) =>
  offer.prices?.find((p) => p?.currency_code === currency && p.min_quantity == null && p.max_quantity == null) ?? null

/** What the shop holds of the offer at its stock location; null when the offer isn't tracked. */
function stockAt(offer: OfferRow, locationId: string | null): number | null {
  if (!offer.manage_inventory) return null
  const level = offer.inventory_items?.[0]?.location_levels?.find((l) => l.location_id === locationId)
  return level ? Number(level.stocked_quantity) : 0
}

/** The shop's offers as a re-import compares its rows with them: price, cost, stock and product title. */
async function loadShopOffers(scope: Scope, sellerId: string, setup: ShopSetup): Promise<ShopOffer[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data }, costs] = await Promise.all([
    query.graph({ entity: "offer", fields: OFFER_FIELDS, filters: { seller_id: sellerId } }),
    offerImportService(scope).listOfferCosts({ seller_id: sellerId }),
  ])
  const offers = data as OfferRow[]
  const { data: products } = offers.length
    ? await query.graph({ entity: "product", fields: ["id", "title"], filters: { id: [...new Set(offers.map((o) => o.product_id))] } })
    : { data: [] }
  const titleOf = new Map((products as { id: string; title: string }[]).map((p) => [p.id, p.title]))
  const costOf = new Map(costs.filter((c) => c.currency_code === setup.currency_code).map((c) => [c.offer_id, Number(c.amount)]))
  return offers.map((offer) => {
    const price = basePrice(offer, setup.currency_code)
    return {
      id: offer.id,
      sku: offer.sku,
      variant_id: offer.variant_id,
      title: titleOf.get(offer.product_id) ?? offer.sku,
      price: price ? Number(price.amount) : null,
      cost: costOf.get(offer.id) ?? null,
      stock: stockAt(offer, setup.stock_location_id),
    }
  })
}

/**
 * What updating one of the shop's offers needs: its whole price list with the
 * new selling price in it (Mercur's update replaces the list), and where its
 * stock is counted.
 */
export async function planOfferUpdate(scope: Scope, update: OfferUpdate, setup: ShopSetup) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [offer] } = (await query.graph({ entity: "offer", fields: OFFER_FIELDS, filters: { id: update.offer_id } })) as {
    data: OfferRow[]
  }
  if (!offer) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Offer ${update.offer_id} was not found.`)

  let prices: OfferPriceInput[] | null = null
  if (update.price !== null) {
    const base = basePrice(offer, setup.currency_code)
    const kept = (offer.prices ?? []).filter((p): p is OfferPrice => !!p?.id)
    prices = kept.map((p) => ({
      id: p.id,
      amount: p.id === base?.id ? update.price! : Number(p.amount),
      currency_code: p.currency_code,
      min_quantity: p.min_quantity,
      max_quantity: p.max_quantity,
      rules: Object.fromEntries((p.price_rules ?? []).filter((r) => r.attribute !== "offer_id").map((r) => [r.attribute, r.value])),
    }))
    if (!base) prices.push({ amount: update.price, currency_code: setup.currency_code })
  }

  let stock: UpdateImportedOfferInput["stock"] = null
  const item = offer.inventory_items?.[0]
  if (update.stock !== null) {
    if (!setup.stock_location_id) throw new MedusaError(MedusaError.Types.INVALID_DATA, "The shop has no stock location to count stock at.")
    if (!item) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Offer ${offer.sku} has no inventory item to count stock on.`)
    stock = {
      inventory_item_id: item.id,
      location_id: setup.stock_location_id,
      stocked_quantity: update.stock,
      has_level: !!item.location_levels?.some((l) => l.location_id === setup.stock_location_id),
    }
  }
  return { prices, stock }
}

type StoreCurrency = { currency_code: string; is_default: boolean }

/**
 * The currency a sheet's prices are in: the store's default, else the first it
 * supports. Never assumed: a store set up without one refuses the import
 * (docs/design.md, multi-country readiness).
 */
export function storeCurrency(currencies: StoreCurrency[] | null | undefined): string {
  const currency = currencies?.find((c) => c.is_default) ?? currencies?.[0]
  if (!currency) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The store has no currency set up, so prices can't be read.")
  }
  return currency.currency_code
}

export async function loadShopSetup(scope: Scope, sellerId: string): Promise<ShopSetup> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data: [store] }, { data: locations }, { data: [lastOffer] }] = await Promise.all([
    query.graph({
      entity: "store",
      fields: ["default_sales_channel_id", "supported_currencies.currency_code", "supported_currencies.is_default"],
    }),
    query.graph({ entity: "stock_location_seller", fields: ["stock_location_id"], filters: { seller_id: sellerId } }),
    query.graph({
      entity: "offer",
      fields: ["shipping_profile_id"],
      filters: { seller_id: sellerId },
      pagination: { take: 1, order: { created_at: "DESC" } },
    }),
  ])
  // A shop new to offers ships them on the marketplace's default profile, as its shipping options do.
  let shippingProfileId: string | null = lastOffer?.shipping_profile_id ?? null
  if (!shippingProfileId) {
    const [profile] = await scope.resolve(Modules.FULFILLMENT).listShippingProfiles({ type: "default" })
    shippingProfileId = profile?.id ?? null
  }
  return {
    currency_code: storeCurrency(store?.supported_currencies as StoreCurrency[] | null | undefined),
    sales_channel_id: store?.default_sales_channel_id ?? null,
    stock_location_id: (locations[0] as { stock_location_id: string } | undefined)?.stock_location_id ?? null,
    shipping_profile_id: shippingProfileId,
  }
}

/** The shop's mapping from its last import, keeping only the columns this sheet has. */
export async function loadSavedOfferMapping(scope: Scope, sellerId: string, headers: string[]): Promise<ImportMapping | null> {
  const [saved] = await offerImportService(scope).listOfferImportMappings({ seller_id: sellerId })
  if (!saved) return null
  const mapping = saved.mapping as ImportMapping
  return Object.fromEntries(Object.entries(mapping).filter(([column]) => headers.includes(column)))
}

/** The shop's whole saved mapping, for the import page. */
export async function savedOfferMapping(scope: Scope, sellerId: string): Promise<ImportMapping | null> {
  const [saved] = await offerImportService(scope).listOfferImportMappings({ seller_id: sellerId })
  return (saved?.mapping as ImportMapping | undefined) ?? null
}

/**
 * Remembers the shop's mapping for its next import. Columns this sheet lacked
 * keep their earlier mapping, unless their field is now mapped from another column.
 */
export async function saveOfferMapping(scope: Scope, sellerId: string, headers: string[], mapping: ImportMapping) {
  const service = offerImportService(scope)
  const [saved] = await service.listOfferImportMappings({ seller_id: sellerId })
  const mapped = new Set(Object.values(mapping))
  const kept = Object.entries((saved?.mapping ?? {}) as ImportMapping).filter(
    ([column, field]) => !headers.includes(column) && !mapped.has(field)
  )
  const next = { ...Object.fromEntries(kept), ...mapping }
  if (saved) await service.updateOfferImportMappings({ id: saved.id, mapping: next })
  else await service.createOfferImportMappings({ seller_id: sellerId, mapping: next })
}
