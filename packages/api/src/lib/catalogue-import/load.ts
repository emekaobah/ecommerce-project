import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import { loadCategoryDefaults } from "../shipping-defaults"
import { assessProductCompleteness, loadRequiredAttributes, type ProductFacts } from "../product-completeness"
import type { CsvTable } from "./csv"
import type { CatalogueAttribute, ImportMapping } from "./fields"
import { barcodeCodes } from "./values"
import { buildImportRows, type ImportCatalogue, type ImportProduct, type ImportRow } from "./rows"

type Scope = Pick<MedusaContainer, "resolve">

type StoreRow = {
  id: string
  default_sales_channel_id: string | null
  metadata: Record<string, unknown> | null
  supported_currencies?: { currency_code: string; is_default: boolean }[] | null
}

async function loadStore(scope: Scope): Promise<StoreRow> {
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "store",
    fields: [
      "id",
      "metadata",
      "default_sales_channel_id",
      "supported_currencies.currency_code",
      "supported_currencies.is_default",
    ],
  })
  const store = data[0] as StoreRow | undefined
  if (!store) throw new MedusaError(MedusaError.Types.NOT_FOUND, "The store is not set up.")
  return store
}

/** Active global attributes, with their values, for mapping and reading cells. */
export async function loadCatalogueAttributes(scope: Scope): Promise<CatalogueAttribute[]> {
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "product_attribute",
    fields: ["id", "name", "handle", "type", "is_variant_axis", "rank", "values.id", "values.name"],
    filters: { is_active: true, product_id: null } as any,
  })
  return (data as any[])
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.name.localeCompare(b.name))
    .map((a) => ({
      id: a.id,
      name: a.name,
      handle: a.handle,
      type: a.type,
      is_variant_axis: !!a.is_variant_axis,
      values: (a.values ?? []).map((v: { id: string; name: string }) => ({ id: v.id, name: v.name })),
    }))
}

/** The SKUs and barcodes among `codes` that catalogue variants already hold. */
async function loadExistingCodes(scope: Scope, codes: { skus: string[]; barcodes: string[] }) {
  if (!codes.skus.length && !codes.barcodes.length) return { skus: [], barcodes: [] }
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "product_variant",
    fields: ["sku", "barcode", "ean", "upc"],
    filters: {
      $or: [{ sku: codes.skus }, { barcode: codes.barcodes }, { ean: codes.barcodes }, { upc: codes.barcodes }],
    } as any,
  })
  const variants = data as { sku: string | null; barcode: string | null; ean: string | null; upc: string | null }[]
  return {
    skus: variants.map((v) => v.sku).filter((s): s is string => !!s),
    barcodes: variants.flatMap(barcodeCodes),
  }
}

/** The catalogue a sheet is read against, minus existing codes (see `readImportRows`). */
export async function loadImportCatalogue(scope: Scope): Promise<ImportCatalogue> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [store, attributes, { data: categories }] = await Promise.all([
    loadStore(scope),
    loadCatalogueAttributes(scope),
    query.graph({ entity: "product_category", fields: ["id", "name", "handle"] }),
  ])
  const currencies = store.supported_currencies ?? []
  const currency = currencies.find((c) => c.is_default) ?? currencies[0]
  return {
    currency_code: currency?.currency_code ?? "ngn",
    sales_channel_id: store.default_sales_channel_id,
    categories: categories as ImportCatalogue["categories"],
    attributes,
    existing: { skus: [], barcodes: [] },
  }
}

/**
 * Reads the sheet's rows, checking their SKUs and barcodes against the
 * catalogue. The rows are read once to learn which codes they carry, so only
 * those are looked up.
 */
export async function readImportRows(
  scope: Scope,
  table: CsvTable,
  mapping: ImportMapping,
  catalogue: ImportCatalogue
): Promise<ImportRow[]> {
  const draft = buildImportRows(table, mapping, catalogue)
  const variants = draft.flatMap((r) => (r.product ? r.product.variants : []))
  const existing = await loadExistingCodes(scope, {
    skus: variants.map((v) => v.sku).filter((s): s is string => !!s),
    barcodes: variants.flatMap(barcodeCodes),
  })
  return buildImportRows(table, mapping, { ...catalogue, existing })
}

/**
 * What the publish gate would say of each row's product once created: the same
 * rule, applied to the product it would create (with its category's default
 * weight, which creation fills in). Rows with no product get an empty list.
 */
export async function previewMissing(scope: Scope, products: (ImportProduct | null)[]): Promise<string[][]> {
  const required = await loadRequiredAttributes(scope)
  // Rows share a handful of categories; look each one's defaults up once.
  const defaultWeights = new Map<string, Promise<number | null>>()
  const defaultWeight = (categoryIds: string[]) => {
    const key = categoryIds.join(",")
    if (!defaultWeights.has(key)) {
      defaultWeights.set(key, loadCategoryDefaults(scope, categoryIds).then((d) => d?.weight ?? null))
    }
    return defaultWeights.get(key)!
  }

  return Promise.all(
    products.map(async (product) => {
      if (!product) return []
      const categoryIds = (product.categories ?? []).map((c) => c.id)
      const facts: ProductFacts = {
        id: "preview",
        status: product.status,
        title: product.title,
        image_count: product.images?.length ?? 0,
        has_thumbnail: !!product.thumbnail,
        category_ids: categoryIds,
        weight: product.weight ?? (await defaultWeight(categoryIds)),
        variants: product.variants.map((_, i) => ({ id: `preview_${i}`, weight: null })),
        attribute_values: Object.fromEntries((product.attributes ?? []).map((a) => [a.id, ["preview"]])),
      }
      return assessProductCompleteness(facts, required).missing.map((m) => m.label)
    })
  )
}

// Saved mappings are a few small operator-wide records, so they live in the
// store's metadata rather than a module and table of their own.
const MAPPINGS_KEY = "catalogue_import_mappings"

type SavedMapping = { source: string; mapping: ImportMapping; updated_at: string }
type SavedMappings = Record<string, SavedMapping>

/** Sources are matched ignoring case and surrounding spaces. */
const sourceKey = (source: string) => source.trim().toLowerCase()

const savedMappings = (store: StoreRow) => (store.metadata?.[MAPPINGS_KEY] ?? {}) as SavedMappings

/** The sources with a saved mapping, most recently used first. */
export async function listImportSources(scope: Scope): Promise<string[]> {
  return Object.values(savedMappings(await loadStore(scope)))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((m) => m.source)
}

/** A source's saved mapping, keeping only the columns this sheet has. */
export async function loadSavedMapping(scope: Scope, source: string, headers: string[]): Promise<ImportMapping | null> {
  const saved = savedMappings(await loadStore(scope))[sourceKey(source)]
  if (!saved) return null
  return Object.fromEntries(Object.entries(saved.mapping).filter(([column]) => headers.includes(column)))
}

/**
 * Remembers a source's mapping for its next import. Columns this sheet lacked
 * keep their earlier mapping, unless their field is now mapped from another column.
 */
export async function saveMapping(scope: Scope, source: string, headers: string[], mapping: ImportMapping): Promise<void> {
  const store = await loadStore(scope)
  const all = savedMappings(store)
  const mapped = new Set(Object.values(mapping))
  const kept = Object.entries(all[sourceKey(source)]?.mapping ?? {}).filter(
    ([column, field]) => !headers.includes(column) && !mapped.has(field)
  )
  const next: SavedMappings = {
    ...all,
    [sourceKey(source)]: {
      source: source.trim(),
      mapping: { ...Object.fromEntries(kept), ...mapping },
      updated_at: new Date().toISOString(),
    },
  }
  await updateStoresWorkflow(scope as MedusaContainer).run({
    input: { selector: { id: store.id }, update: { metadata: { ...store.metadata, [MAPPINGS_KEY]: next } } },
  })
}
