import { MedusaResponse } from "@medusajs/framework/http"
import { readSheet, suggestMapping, type ImportMapping } from "../../../../lib/catalogue-import"
import {
  buildOfferImportRows,
  loadOfferImportContext,
  loadSavedOfferMapping,
  OFFER_IMPORT_FIELDS,
  offerImportField,
  offerMappingErrors,
  type OfferImportRow,
} from "../../../../lib/offer-import"
import { sellerOf, type VendorRequest } from "../seller"
import type { VendorPreviewOfferImportType } from "../validators"

type PreviewRow = Pick<OfferImportRow, "row" | "title" | "action" | "errors" | "warnings"> & {
  price: number | null
  cost: number | null
  stock: number | null
}

type PreviewResponse = {
  headers: string[]
  /** Each column's first non-empty cell, to show the shop what it holds. */
  samples: Record<string, string>
  mapping: ImportMapping
  /** Where the mapping came from: the request, the shop's last import, or header names. */
  mapping_origin: "request" | "saved" | "suggested"
  mapping_errors: string[]
  rows: PreviewRow[]
  summary: { total: number; offers: number; proposals: number; invalid: number }
}

/** Reads the shop's sheet through a mapping without creating anything, saying what each row would do. */
export async function POST(req: VendorRequest<VendorPreviewOfferImportType>, res: MedusaResponse<PreviewResponse>) {
  const sellerId = sellerOf(req)
  const table = readSheet(req.validatedBody.csv)

  let mapping = req.validatedBody.mapping
  let origin: PreviewResponse["mapping_origin"] = "request"
  if (!mapping) {
    const saved = await loadSavedOfferMapping(req.scope, sellerId, table.headers)
    if (saved) {
      mapping = Object.fromEntries(Object.entries(saved).filter(([, field]) => offerImportField(field)))
      origin = "saved"
    } else {
      mapping = suggestMapping(table.headers, OFFER_IMPORT_FIELDS)
      origin = "suggested"
    }
  }

  const problems = offerMappingErrors(mapping, table.headers)
  const rows = problems.length
    ? []
    : buildOfferImportRows(table, mapping, await loadOfferImportContext(req.scope, sellerId, table, mapping))
  const count = (action: OfferImportRow["action"]) => rows.filter((r) => r.action === action).length

  res.json({
    headers: table.headers,
    samples: Object.fromEntries(table.headers.map((h, i) => [h, table.rows.find((r) => r[i])?.[i] ?? ""])),
    mapping,
    mapping_origin: origin,
    mapping_errors: problems,
    rows: rows.map(({ row, title, action, errors, warnings, offer }) => ({
      row,
      title,
      action,
      errors,
      warnings,
      price: offer?.price ?? null,
      cost: offer?.cost ?? null,
      stock: offer?.stock ?? null,
    })),
    summary: { total: table.rows.length, offers: count("offer"), proposals: count("propose"), invalid: count(null) },
  })
}
