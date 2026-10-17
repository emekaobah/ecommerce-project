/**
 * Picking a seller order (docs/design.md, "Order state machine"): staff walk the aisles with a
 * checklist of the order's lines, ticking each off by hand or by scanning its barcode. The
 * order can be packed once every line is picked in full.
 *
 * Units the shop doesn't have are marked unavailable instead (#22): they are no longer to be
 * picked, and are removed from the order, with the buyer refunded for them, before it is packed.
 */

/**
 * One order line on the checklist. `codes` are the barcodes its variant carries (barcode, EAN,
 * UPC). `unavailable` units are marked as not in stock, waiting to be removed from the order.
 */
export type PickLine = { id: string; quantity: number; picked: number; unavailable: number; codes: string[] }

export type ScanResult =
  /** The scan picked one more of the line; `picked` is its new count. */
  | { kind: "picked"; lineId: string; picked: number }
  /** The barcode is on the order, but its lines are already picked in full. */
  | { kind: "already_picked"; lineId: string }
  /** No line of the order carries the barcode: likely the wrong product. */
  | { kind: "not_in_order" }

/**
 * What scanning a barcode does to the checklist. Numeric codes match as GTINs, so a UPC-A a
 * scanner reads as a 13-digit EAN (with a leading zero) still matches its line.
 */
export function scanBarcode(lines: PickLine[], scanned: string): ScanResult {
  const code = normalise(scanned)
  if (!code) return { kind: "not_in_order" }
  const matching = lines.filter((line) => line.codes.some((c) => normalise(c) === code))
  const [first] = matching
  if (!first) return { kind: "not_in_order" }
  const short = matching.find((line) => line.picked + line.unavailable < line.quantity)
  if (!short) return { kind: "already_picked", lineId: first.id }
  return { kind: "picked", lineId: short.id, picked: short.picked + 1 }
}

export type PickProgress = {
  /** Units picked, and units ordered. */
  picked: number
  total: number
  /** Units marked unavailable, still on the order until they are removed. */
  unavailable: number
  /** Ids of the lines with units still to pick: neither picked nor marked unavailable. */
  unpicked: string[]
  /** Every line is picked in full (nothing waits to be removed), so the order can be packed. */
  done: boolean
  /**
   * Every unit is marked unavailable: removing them would leave nothing to send, so staff are
   * offered to cancel the order instead (#17).
   */
  allUnavailable: boolean
}

export function pickProgress(lines: PickLine[]): PickProgress {
  const sum = (count: (line: PickLine) => number) => lines.reduce((total, line) => total + count(line), 0)
  const total = sum((line) => line.quantity)
  return {
    picked: sum((line) => Math.min(line.picked, line.quantity)),
    total,
    unavailable: sum((line) => line.unavailable),
    unpicked: lines.filter((line) => line.picked + line.unavailable < line.quantity).map((line) => line.id),
    done: lines.length > 0 && lines.every((line) => line.picked >= line.quantity),
    allUnavailable: total > 0 && sum((line) => Math.min(line.unavailable, line.quantity)) >= total,
  }
}

/** A code in one comparable form: GTINs as 14 digits, anything else trimmed and upper-cased. */
function normalise(code: string) {
  const trimmed = code.trim()
  if (/^\d{8,14}$/.test(trimmed)) return trimmed.padStart(14, "0")
  return trimmed.toUpperCase()
}
