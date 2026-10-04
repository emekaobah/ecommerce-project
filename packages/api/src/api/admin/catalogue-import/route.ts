import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  importFields,
  importRows,
  listImportSources,
  loadCatalogueAttributes,
  loadImportCatalogue,
  readSheet,
  mappingErrors,
  readImportRows,
  saveMapping,
  summarise,
  type ImportField,
  type ImportResult,
} from "../../../lib/catalogue-import"
import type { AdminRunCatalogueImportType } from "./validators"

/** The fields a column can map to, and the sources with a saved mapping. */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ fields: ImportField[]; sources: string[] }>
) {
  const [attributes, sources] = await Promise.all([loadCatalogueAttributes(req.scope), listImportSources(req.scope)])
  res.json({ fields: importFields(attributes), sources })
}

/**
 * Imports a catalogue sheet: remembers the mapping for the source, then creates
 * each valid row as a draft product. Invalid rows are skipped and reported.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<AdminRunCatalogueImportType>,
  res: MedusaResponse<{ results: ImportResult[]; summary: ReturnType<typeof summarise> }>
) {
  const { csv, source, mapping } = req.validatedBody
  const table = readSheet(csv)
  const catalogue = await loadImportCatalogue(req.scope)
  const problems = mappingErrors(mapping, table.headers, catalogue)
  if (problems.length) throw new MedusaError(MedusaError.Types.INVALID_DATA, problems.join(" "))

  await saveMapping(req.scope, source, table.headers, mapping)
  const rows = await readImportRows(req.scope, table, mapping, catalogue)
  const results = await importRows(req.scope, rows, { created_by: req.auth_context.actor_id })
  res.json({ results, summary: summarise(results) })
}
