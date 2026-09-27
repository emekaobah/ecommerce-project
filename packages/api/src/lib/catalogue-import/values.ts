/**
 * Parsers for the messy cells of a catalogue spreadsheet. Each returns either
 * the value in the catalogue's units or an error the operator can act on, and a
 * warning when it had to repair the cell.
 */
export type Parsed<T> = { ok: true; value: T; warning?: string } | { ok: false; error: string }

/** A variant's barcode fields. Mercur stores EAN and UPC; GTIN, ISBN and ASIN map onto them. */
export type Barcode = { barcode: string; ean?: string; upc?: string }

/** Every code a variant's barcode fields hold, for duplicate checks. */
export const barcodeCodes = (b: { barcode?: string | null; ean?: string | null; upc?: string | null }) =>
  [b.barcode, b.ean, b.upc].filter((c): c is string => !!c)

/** GS1 check digit (mod 10, weights 3 and 1 from the right) over a whole code. */
function gs1CheckDigitValid(code: string): boolean {
  const digits = [...code].map(Number)
  const check = digits.pop()!
  digits.reverse()
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

function isbn10Valid(code: string): boolean {
  const sum = [...code].reduce((acc, c, i) => acc + (c.toUpperCase() === "X" ? 10 : Number(c)) * (10 - i), 0)
  return sum % 11 === 0
}

/** The EAN-13 (978 prefix) an ISBN-10 is published under. */
function isbn10ToEan(code: string): string {
  const body = `978${code.slice(0, 9)}`
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
  return body + ((10 - (sum % 10)) % 10)
}

/** Files a valid GTIN under the field Mercur keeps it in. */
function fileGtin(code: string): Barcode {
  switch (code.length) {
    case 8:
    case 13:
      return { barcode: code, ean: code }
    case 12:
      return { barcode: code, upc: code }
    default:
      // GTIN-14: a zero indicator digit wraps an EAN-13; other indicators are case codes.
      return code.startsWith("0") ? { barcode: code, ean: code.slice(1) } : { barcode: code }
  }
}

const GTIN_LENGTHS = new Set([8, 12, 13, 14])
const TEXT_HINT = "Format the barcode column as text in the spreadsheet and export again."

/**
 * Reads a barcode as text. Spreadsheets damage barcodes by treating them as
 * numbers: they drop leading zeros, append ".0", or switch to scientific
 * notation. Repairs are made only when nothing was lost (the check digit agrees);
 * otherwise the row is refused rather than stored with a wrong code.
 */
export function parseBarcode(input: string): Parsed<Barcode> {
  const unscientific = undoScientificNotation(input.trim().replace(/[\s-]/g, ""), input)
  if (!unscientific.ok) return unscientific
  const code = unscientific.value.replace(/\.0+$/, "")
  const warning = unscientific.warning

  // Ten characters are an ISBN-10 only if its check digit agrees; ten digits
  // could also be a GTIN that lost two leading zeros.
  if (/^\d{9}[\dX]$/i.test(code) && isbn10Valid(code)) {
    const ean = isbn10ToEan(code)
    return { ok: true, value: { barcode: ean, ean }, ...(warning && { warning }) }
  }
  if (/^\d+$/.test(code)) return parseGtin(code, input, warning)
  if (/^B0[A-Z0-9]{8}$/i.test(code)) {
    return { ok: false, error: `"${input.trim()}" is an Amazon ASIN, which has no EAN or UPC. Use the product's barcode.` }
  }
  return { ok: false, error: `"${input.trim()}" is not a barcode.` }
}

/** "5.901234123457E+12" back to its digits, refused if the notation dropped any. */
function undoScientificNotation(code: string, input: string): Parsed<string> {
  const scientific = /^(\d)(?:\.(\d+))?e\+?(\d+)$/i.exec(code)
  if (!scientific) return { ok: true, value: code }
  const [, lead, fraction = "", exponent] = scientific
  if (fraction.length !== Number(exponent)) {
    return { ok: false, error: `Barcode "${input.trim()}" lost digits to scientific notation. ${TEXT_HINT}` }
  }
  const digits = lead + fraction
  return { ok: true, value: digits, warning: `Barcode was in scientific notation; read it as ${digits}.` }
}

/** An all-digit code as a GTIN, restoring leading zeros a spreadsheet dropped. */
function parseGtin(digits: string, input: string, scientificWarning: string | undefined): Parsed<Barcode> {
  let code = digits
  let warning = scientificWarning
  // A spreadsheet dropped the leading zeros of a 12- or 13-digit code.
  if (code.length >= 9 && code.length <= 11 && gs1CheckDigitValid(code)) {
    code = code.padStart(13, "0")
    warning = `Barcode had lost its leading zeros; read it as ${code}.`
  }
  if (!GTIN_LENGTHS.has(code.length)) {
    return { ok: false, error: `"${input.trim()}" is not a barcode: expected 8, 12, 13 or 14 digits.` }
  }
  if (!gs1CheckDigitValid(code)) {
    return { ok: false, error: `Barcode "${input.trim()}" has a wrong check digit.` }
  }
  return { ok: true, value: fileGtin(code), ...(warning && { warning }) }
}

/**
 * A decimal number as spreadsheets write it: "1,200" (thousands), "1,5" (a
 * decimal comma) or "1.5". A comma followed by exactly three digits is taken as
 * a thousands separator.
 */
function readNumber(text: string): number {
  const normalised = text.replace(/,(?=\d{3}(?!\d))/g, "").replace(",", ".")
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalised) ? Number(normalised) : Number.NaN
}

/** Reads "<number><unit>" and converts it by the unit's factor; a bare number is in `defaultUnit`. */
function parseMeasure(
  input: string,
  factors: Record<string, number>,
  defaultUnit: string,
  describe: string,
  round: (n: number) => number
): Parsed<number> {
  const match = /^([\d.,]+)\s*([a-z"]*)\.?$/i.exec(input.trim())
  const unit = (match?.[2] || defaultUnit).toLowerCase()
  const amount = match ? readNumber(match[1]) : Number.NaN
  const factor = factors[unit]
  if (!factor || Number.isNaN(amount) || amount <= 0) {
    return {
      ok: false,
      error: `"${input.trim()}" is not a ${describe}: use a number with a unit (${Object.keys(factors).join(", ")}).`,
    }
  }
  return { ok: true, value: round(amount * factor) }
}

const GRAMS: Record<string, number> = { g: 1, gr: 1, kg: 1000, lb: 453.59237, lbs: 453.59237, oz: 28.349523125 }
const CENTIMETRES: Record<string, number> = { cm: 1, mm: 0.1, m: 100, in: 2.54, '"': 2.54 }

/**
 * The unit a column header names in brackets, such as "Weight (kg)", if it is
 * one of the given units.
 */
export function headerUnit(header: string, kind: "weight" | "length"): string | undefined {
  const unit = /[([]\s*([a-z"]+)\s*[)\]]/i.exec(header)?.[1]?.toLowerCase()
  const units = kind === "weight" ? GRAMS : CENTIMETRES
  return unit && unit in units ? unit : undefined
}

/** A weight in whole grams: "1.5kg", "300g", "2 lb", "12oz"; a bare number is in `defaultUnit`. */
export const parseWeight = (input: string, defaultUnit = "g") =>
  parseMeasure(input, GRAMS, defaultUnit, "weight", Math.round)

/** A length in centimetres to one decimal: "30cm", "300mm", "1.2m", "12in"; a bare number is in `defaultUnit`. */
export const parseLength = (input: string, defaultUnit = "cm") =>
  parseMeasure(input, CENTIMETRES, defaultUnit, "length", (n) => Math.round(n * 10) / 10)

/** A price in major units: "₦1,500", "NGN 14,500.50", "N2500". */
export function parsePrice(input: string): Parsed<number> {
  const amount = readNumber(input.trim().replace(/^(₦|ngn|n)\s*/i, ""))
  if (Number.isNaN(amount) || amount <= 0) return { ok: false, error: `"${input.trim()}" is not a price.` }
  return { ok: true, value: amount }
}
