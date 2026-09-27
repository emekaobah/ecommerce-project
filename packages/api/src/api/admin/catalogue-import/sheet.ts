import { MedusaError } from "@medusajs/framework/utils"
import { parseCsv, type CsvTable } from "../../../lib/catalogue-import"
import { MAX_IMPORT_ROWS } from "./validators"

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
