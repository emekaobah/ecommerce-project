import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  importFields,
  loadImportCatalogue,
  loadSavedMapping,
  mappingErrors,
  previewMissing,
  readImportRows,
  suggestMapping,
  type ImportMapping,
} from "../../../../lib/catalogue-import"
import { readSheet } from "../sheet"
import type { AdminPreviewCatalogueImportType } from "../validators"

type PreviewRow = {
  row: number
  title: string | null
  errors: string[]
  warnings: string[]
  /** What the product would still need before it can be published. */
  missing: string[]
}

type PreviewResponse = {
  headers: string[]
  /** Each column's first non-empty cell, to show the operator what it holds. */
  samples: Record<string, string>
  mapping: ImportMapping
  /** Where the mapping came from: the request, the source's last import, or header names. */
  mapping_origin: "request" | "saved" | "suggested"
  mapping_errors: string[]
  rows: PreviewRow[]
  summary: { total: number; valid: number; invalid: number }
}

/** Reads a sheet through a mapping without creating anything, reporting each row. */
export async function POST(
  req: AuthenticatedMedusaRequest<AdminPreviewCatalogueImportType>,
  res: MedusaResponse<PreviewResponse>
) {
  const { csv, source } = req.validatedBody
  const table = readSheet(csv)
  const catalogue = await loadImportCatalogue(req.scope)
  const fieldKeys = new Set(importFields(catalogue.attributes).map((f) => f.key))

  let mapping = req.validatedBody.mapping
  let origin: PreviewResponse["mapping_origin"] = "request"
  if (!mapping) {
    // A saved mapping may name an attribute since removed; that column is left unmapped.
    const saved = source ? await loadSavedMapping(req.scope, source, table.headers) : null
    if (saved) {
      mapping = Object.fromEntries(Object.entries(saved).filter(([, field]) => fieldKeys.has(field)))
      origin = "saved"
    } else {
      mapping = suggestMapping(table.headers, importFields(catalogue.attributes))
      origin = "suggested"
    }
  }

  const problems = mappingErrors(mapping, table.headers, catalogue)
  const rows = problems.length ? [] : await readImportRows(req.scope, table, mapping, catalogue)
  const missing = await previewMissing(req.scope, rows.map((r) => r.product))
  const preview = rows.map(({ product: _product, ...row }, i) => ({ ...row, missing: missing[i] }))
  const valid = rows.filter((r) => r.product).length

  res.json({
    headers: table.headers,
    samples: Object.fromEntries(table.headers.map((h, i) => [h, table.rows.find((r) => r[i])?.[i] ?? ""])),
    mapping,
    mapping_origin: origin,
    mapping_errors: problems,
    rows: preview,
    summary: { total: table.rows.length, valid, invalid: table.rows.length - valid },
  })
}
