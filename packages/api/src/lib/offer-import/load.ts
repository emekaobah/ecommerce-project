import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import { barcodeCodes, parseBarcode, type CsvTable, type ImportMapping } from "../catalogue-import"
import { OFFER_IMPORT_MODULE, type OfferImportModuleService } from "../../modules/offer-import"
import type { CatalogueVariant, OfferImportContext } from "./rows"

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
  mapping: ImportMapping
): Promise<OfferImportContext> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const codes = [...new Set(sheetBarcodes(table, mapping))]
  const [setup, { data: categories }, { data: variants }, { data: offers }] = await Promise.all([
    loadShopSetup(scope, sellerId),
    query.graph({ entity: "product_category", fields: ["id", "name", "handle"] }),
    codes.length
      ? query.graph({
          entity: "product_variant",
          fields: ["id", "product_id", "barcode", "ean", "upc", "product.title", "product.status"],
          filters: { $or: [{ barcode: codes }, { ean: codes }, { upc: codes }] } as any,
        })
      : Promise.resolve({ data: [] }),
    query.graph({ entity: "offer", fields: ["sku", "variant_id"], filters: { seller_id: sellerId } }),
  ])
  return {
    currency_code: setup.currency_code,
    categories: categories as OfferImportContext["categories"],
    variants: (variants as VariantRow[]).map(
      (v): CatalogueVariant => ({
        id: v.id,
        product_id: v.product_id,
        title: v.product?.title ?? "",
        published: v.product?.status === ProductStatus.PUBLISHED,
        codes: barcodeCodes(v),
      })
    ),
    offers: offers as OfferImportContext["offers"],
  }
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
  const currencies = (store?.supported_currencies ?? []) as { currency_code: string; is_default: boolean }[]
  const currency = currencies.find((c) => c.is_default) ?? currencies[0]
  // A shop new to offers ships them on the marketplace's default profile, as its shipping options do.
  let shippingProfileId: string | null = lastOffer?.shipping_profile_id ?? null
  if (!shippingProfileId) {
    const [profile] = await scope.resolve(Modules.FULFILLMENT).listShippingProfiles({ type: "default" })
    shippingProfileId = profile?.id ?? null
  }
  return {
    currency_code: currency?.currency_code ?? "ngn",
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
