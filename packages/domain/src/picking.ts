/**
 * Picking a seller order (docs/design.md, "Order state machine"): staff walk the aisles with a
 * checklist of the order's lines, ticking each off by hand or by scanning its barcode. The
 * order can be packed once every line is picked in full.
 *
 * Units the shop doesn't have are marked unavailable instead (#22): they are no longer to be
 * picked, and are removed from the order, with the buyer refunded for them, before it is packed.
 */

import { formatWeight } from "./listing"

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

/** The pick list's band: "Picking · 3 of 5" units, and how far along that is (0 to 1) for its progress bar. */
export function pickBand(progress: Pick<PickProgress, "picked" | "total">): { label: string; fraction: number } {
  return {
    label: `Picking · ${progress.picked} of ${progress.total}`,
    fraction: progress.total > 0 ? Math.min(progress.picked / progress.total, 1) : 0,
  }
}

/** How a pick list line reads: its quantity pill, the note under its name, and what a screen reader says. */
export type PickLineView = {
  pill: { label: string; tone: "neutral" | "picked" | "short" }
  note: string
  noteTone: "muted" | "ember"
  spoken: string
}

/**
 * A pick list line as staff see it: the pill "2/2" turns leaf once picked in full and ember while
 * units are marked short; the note says "Picked", how many are short, or how to tick it (a line
 * with no barcode is ticked by hand). Perishable lines say so until they are picked.
 */
export function pickLineView(line: PickLine & { perishable: boolean }): PickLineView {
  const count = `${line.picked}/${line.quantity}`
  const picked = `${line.picked} of ${line.quantity} picked`
  if (line.picked >= line.quantity) {
    return { pill: { label: count, tone: "picked" }, note: "Picked", noteTone: "muted", spoken: picked }
  }
  const perishable = line.perishable ? "Perishable" : null
  const short = line.unavailable > 0 ? `${line.unavailable} not available` : null
  const join = (parts: (string | null)[], separator: string) => parts.filter(Boolean).join(separator)
  const spoken = join([perishable, picked, short], ", ")
  if (short) return { pill: { label: count, tone: "short" }, note: join([perishable, short], " · "), noteTone: "ember", spoken }
  const byHand = line.codes.length ? null : "No barcode: tick by hand"
  let progress: string | null = null
  if (line.picked > 0) progress = picked
  else if (!byHand) progress = "Tap to tick"
  return {
    pill: { label: count, tone: "neutral" },
    note: join([perishable, progress, byHand], " · "),
    noteTone: "muted",
    spoken,
  }
}

type WeighedItem = {
  quantity: number | string
  variant?: { weight?: number | string | null; product?: { weight?: number | string | null } | null } | null
}

/**
 * The parcel's weight from the catalogue, for booking its courier: each line's variant weight
 * (else its product's), in grams, times its quantity, "about 16 kg" to a tenth of a kilo. Null
 * when no line has a weight.
 */
export function parcelWeightLabel(items: WeighedItem[]): string | null {
  const weights = items.flatMap((item) => {
    const grams = Number(item.variant?.weight ?? item.variant?.product?.weight ?? 0)
    return grams > 0 ? [grams * Number(item.quantity)] : []
  })
  if (!weights.length) return null
  const grams = weights.reduce((total, weight) => total + weight, 0)
  return `about ${formatWeight(grams < 1000 ? Math.round(grams) : Math.round(grams / 100) * 100)}`
}

/**
 * The Not available counter for a line (#22): from none up to the units not yet picked
 * (`most`), starting at what is marked already, else one, and never above `most`; a line picked
 * in full has none left to mark.
 */
export function unavailableCounter(line: Pick<PickLine, "quantity" | "picked" | "unavailable">): { most: number; start: number } {
  const most = Math.max(line.quantity - line.picked, 0)
  return { most, start: Math.min(Math.max(line.unavailable, 1), most) }
}
