/** A parsed CSV file: the header row, then each data row, every cell as text. */
export type CsvTable = { headers: string[]; rows: string[][] }

const DELIMITERS = [",", ";", "\t"] as const

/**
 * The delimiter a spreadsheet export used, judged by the header row: comma,
 * semicolon (European Excel) or tab, whichever splits it into the most columns.
 */
function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  return DELIMITERS.map((d) => ({ d, count: firstLine.split(d).length }))
    .sort((a, b) => b.count - a.count)[0].d
}

/**
 * RFC 4180 CSV: quoted cells may hold delimiters, line breaks and doubled
 * quotes. Cells are never converted to numbers, so barcodes keep their leading
 * zeros. A byte-order mark is dropped, blank lines skipped, and cells trimmed.
 */
export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^\uFEFF/, "")
  const [headers = [], ...rows] = readRecords(text, detectDelimiter(text))
  return { headers, rows: rows.map((row) => headers.map((_, i) => row[i] ?? "")) }
}

/** Every record with a non-blank cell, each cell trimmed. */
function readRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = []
  let i = 0
  while (i < text.length) {
    const record: string[] = []
    let end: number
    do {
      const cell = readCell(text, i, delimiter)
      record.push(cell.value.trim())
      end = cell.end
      i = end + 1
    } while (text[end] === delimiter)
    if (text[end] === "\r" && text[end + 1] === "\n") i++
    if (record.some((c) => c !== "")) records.push(record)
  }
  return records
}

/** The cell starting at `start`, and where it ends: at a delimiter, a line break or the end of the text. */
function readCell(text: string, start: number, delimiter: string): { value: string; end: number } {
  let value = ""
  let i = start
  while (i < text.length && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") {
    if (text[i] === '"') {
      const quoted = readQuoted(text, i + 1)
      value += quoted.value
      i = quoted.end
    } else {
      value += text[i]
      i++
    }
  }
  return { value, end: i }
}

/** The text of a quoted section opened just before `start`, and the index after its closing quote. */
function readQuoted(text: string, start: number): { value: string; end: number } {
  let value = ""
  let i = start
  while (i < text.length) {
    if (text[i] !== '"') {
      value += text[i]
      i++
    } else if (text[i + 1] === '"') {
      value += '"'
      i += 2
    } else {
      return { value, end: i + 1 }
    }
  }
  return { value, end: i }
}
