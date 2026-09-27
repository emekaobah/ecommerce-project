import type { MedusaContainer } from "@medusajs/framework/types"
import { createProductsWorkflow } from "@mercurjs/core/workflows"
import { getProductCompleteness } from "../product-completeness"
import type { ImportRow } from "./rows"

export type ImportResult = {
  row: number
  title: string | null
  /** `created`: a draft product; `skipped`: the row had errors; `failed`: the catalogue refused it. */
  status: "created" | "skipped" | "failed"
  product_id: string | null
  errors: string[]
  warnings: string[]
  /** What the product still needs before it can be published. */
  missing: string[]
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Creates each valid row as a draft through Mercur's create-products workflow,
 * so category shipping defaults and the publish gate apply as they do to any
 * product. Rows run one at a time and independently: one refused row rolls back
 * only itself.
 *
 * Imported products are never published here. A master product's price comes
 * from a shop's offer, so a new product can't pass the publish gate until a shop
 * lists it; each result says what the product still needs.
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
        input: { products: [row.product as any], created_by: options.created_by },
      })
      const completeness = await getProductCompleteness(scope, result[0].id)
      results.push({
        ...base,
        status: "created",
        product_id: result[0].id,
        missing: completeness.missing.map((m) => m.label),
      })
    } catch (error) {
      results.push({ ...base, status: "failed", product_id: null, errors: [message(error)] })
    }
  }
  return results
}

export function summarise(results: ImportResult[]) {
  const count = (status: ImportResult["status"]) => results.filter((r) => r.status === status).length
  return { total: results.length, created: count("created"), skipped: count("skipped"), failed: count("failed") }
}
