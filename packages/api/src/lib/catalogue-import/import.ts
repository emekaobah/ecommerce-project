import type { MedusaContainer } from "@medusajs/framework/types"
import { createProductsWorkflow } from "@mercurjs/core/workflows"
import { errorMessage } from "../errors"
import { queueEnrichment, type EnrichableField } from "../enrichment"
import { getProductCompleteness } from "../product-completeness"
import type { ImportProduct, ImportRow } from "./rows"

export type ImportResult = {
  row: number
  title: string | null
  /**
   * `created`: a draft product, queued for enrichment; `skipped`: the row had
   * errors; `failed`: the catalogue refused it.
   */
  status: "created" | "skipped" | "failed"
  product_id: string | null
  errors: string[]
  warnings: string[]
  /** What the product still needs before it can be published, before enrichment fills what it can. */
  missing: string[]
}


/**
 * Creates each valid row as a draft through Mercur's create-products workflow,
 * so category shipping defaults and the publish gate apply as they do to any
 * product. Rows run one at a time and independently: one refused row rolls back
 * only itself.
 *
 * Imported products are never published here: each is queued for enrichment,
 * which fills its empty fields in the background and then publishes it or sends
 * it for review (lib/enrichment). The operator reviewed the sheet at preview, so
 * its own data needs no second review.
 */
export async function importRows(
  scope: MedusaContainer,
  rows: ImportRow[],
  options: { created_by: string }
): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  for (const row of rows) {
    const base = { row: row.row, title: row.title, errors: row.errors, warnings: row.warnings, missing: [] }
    if (!row.product) {
      results.push({ ...base, status: "skipped", product_id: null })
      continue
    }
    try {
      const { result } = await createProductsWorkflow(scope).run({
        input: { products: [row.product], created_by: options.created_by },
      })
      // Queued as soon as it exists, so a request cut short leaves nothing un-enriched.
      await queueEnrichment(scope, [{ product_id: result[0].id, supplied: suppliedFields(row.product) }], "operator")
      const completeness = await getProductCompleteness(scope, result[0].id)
      results.push({
        ...base,
        status: "created",
        product_id: result[0].id,
        missing: completeness.missing.map((m) => m.label),
      })
    } catch (error) {
      results.push({ ...base, status: "failed", product_id: null, errors: [errorMessage(error)] })
    }
  }
  return results
}

/**
 * The enrichable fields the sheet filled in. A row without a title is named after
 * its barcode until a source names it, so that title isn't supplied.
 */
export function suppliedFields(
  product: Pick<ImportProduct, "title" | "description" | "weight" | "images" | "categories"> & {
    variants: [{ barcode?: string; ean?: string; upc?: string }]
  }
): EnrichableField[] {
  const [variant] = product.variants
  const standIn = [variant.barcode, variant.ean, variant.upc].includes(product.title)
  const supplied: EnrichableField[] = []
  if (!standIn) supplied.push("title")
  if (product.description) supplied.push("description")
  if (product.weight) supplied.push("weight")
  if (product.images?.length) supplied.push("images")
  if (product.categories?.length) supplied.push("categories")
  return supplied
}

export function summarise(results: ImportResult[]) {
  const count = (status: ImportResult["status"]) => results.filter((r) => r.status === status).length
  return { total: results.length, created: count("created"), skipped: count("skipped"), failed: count("failed") }
}
