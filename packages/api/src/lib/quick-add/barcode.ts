import { parseBarcode, type Barcode } from "../catalogue-import"

const GTIN_LENGTHS = [8, 12, 13, 14]

export type ScannedBarcode =
  | {
      ok: true
      /** The barcode as a new product's variant files it. */
      barcode: Barcode
      /** Every form the catalogue may have filed the same GTIN under, shortest first. */
      lookup: string[]
    }
  | { ok: false; error: string }

/**
 * Reads a barcode the camera scanned. A GTIN is looked up in each of its lengths,
 * so a UPC-A the camera reads as a 13-digit EAN (with a leading zero) still finds
 * the product filed under its 12-digit UPC. A code whose check digit is wrong is
 * refused, never looked up.
 */
export function readScannedBarcode(scanned: string): ScannedBarcode {
  const parsed = parseBarcode(scanned)
  if (!parsed.ok) return parsed
  const code = parsed.value.barcode
  const bare = code.replace(/^0+/, "")
  const lookup = GTIN_LENGTHS.filter((length) => bare.length <= length).map((length) => bare.padStart(length, "0"))
  return { ok: true, barcode: parsed.value, lookup }
}
