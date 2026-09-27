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
  const text = input.replace(/^﻿/, "")
  const delimiter = detectDelimiter(text)
  const records: string[][] = []
  let record: string[] = []
  let cell = ""
  let quoted = false

  const endCell = () => {
    record.push(cell.trim())
    cell = ""
  }
  const endRecord = () => {
    endCell()
    if (record.some((c) => c !== "")) records.push(record)
    record = []
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      endCell()
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++
      endRecord()
    } else {
      cell += char
    }
  }
  if (cell !== "" || record.length) endRecord()

  const [headers = [], ...rows] = records
  return { headers, rows: rows.map((row) => headers.map((_, i) => row[i] ?? "")) }
}
