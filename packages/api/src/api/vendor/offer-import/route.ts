import { MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import type { ImportMapping } from "../../../lib/catalogue-import"
import {
  buildOfferImportRows,
  importOfferRows,
  loadOfferImportContext,
  loadShopSetup,
  OFFER_IMPORT_FIELDS,
  offerMappingErrors,
  saveOfferMapping,
  savedOfferMapping,
  summariseOfferImport,
  type OfferImportField,
  type OfferImportResult,
} from "../../../lib/offer-import"
import { readSheet } from "../../admin/catalogue-import/sheet"
import { sellerOf, type VendorRequest } from "./seller"
import type { VendorRunOfferImportType } from "./validators"

/** The fields a column can map to, and the shop's mapping from its last import. */
export async function GET(
  req: VendorRequest,
  res: MedusaResponse<{ fields: OfferImportField[]; mapping: ImportMapping | null }>
) {
  res.json({ fields: OFFER_IMPORT_FIELDS, mapping: await savedOfferMapping(req.scope, sellerOf(req)) })
}

/**
 * Imports the shop's product list: remembers the mapping for its next import,
 * then offers each matched row and proposes each unmatched one. Rows with
 * errors are skipped and reported.
 */
export async function POST(
  req: VendorRequest<VendorRunOfferImportType>,
  res: MedusaResponse<{ results: OfferImportResult[]; summary: ReturnType<typeof summariseOfferImport> }>
) {
  const sellerId = sellerOf(req)
  const { csv, mapping } = req.validatedBody
  const table = readSheet(csv)
  const problems = offerMappingErrors(mapping, table.headers)
  if (problems.length) throw new MedusaError(MedusaError.Types.INVALID_DATA, problems.join(" "))

  await saveOfferMapping(req.scope, sellerId, table.headers, mapping)
  const [context, setup] = await Promise.all([
    loadOfferImportContext(req.scope, sellerId, table, mapping),
    loadShopSetup(req.scope, sellerId),
  ])
  const rows = buildOfferImportRows(table, mapping, context)
  const results = await importOfferRows(req.scope, rows, { seller_id: sellerId, member_id: req.auth_context.actor_id, setup })
  res.json({ results, summary: summariseOfferImport(results) })
}
