import { MedusaError } from "@medusajs/framework/utils"
import { parseCsv, type CsvTable } from "./csv"

/**
 * Rows per import, for the operator's catalogue import and a shop's product
 * list alike; larger files are imported in parts. Each row runs its own
 * workflow within the request, so this keeps an import to a minute or two.
 */
export const MAX_IMPORT_ROWS = 500

/** Parses an uploaded sheet, refusing one with no rows or too many. */
export function readSheet(csv: string): CsvTable {
  const table = parseCsv(csv)
  if (!table.headers.length || !table.rows.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "The file has no rows below its header.")
  }
  if (table.rows.length > MAX_IMPORT_ROWS) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `The file has ${table.rows.length} rows; import at most ${MAX_IMPORT_ROWS} at a time.`
    )
  }
  return table
}
