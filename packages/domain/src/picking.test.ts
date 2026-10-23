import { describe, expect, test } from "bun:test"
import { parcelWeightLabel, pickBand, pickLineView, pickProgress, scanBarcode, type PickLine } from "./picking"

const rice: PickLine = { id: "item_rice", quantity: 2, picked: 0, unavailable: 0, codes: ["5901234123457"] }
const lantern: PickLine = { id: "item_lantern", quantity: 1, picked: 0, unavailable: 0, codes: ["036000291452"] }
const cap: PickLine = { id: "item_cap", quantity: 1, picked: 0, unavailable: 0, codes: [] }

describe("scanBarcode", () => {
  test("picks one more of the line the barcode is on", () => {
    expect(scanBarcode([rice, lantern], "5901234123457")).toEqual({ kind: "picked", lineId: "item_rice", picked: 1 })
    expect(scanBarcode([{ ...rice, picked: 1 }], "5901234123457")).toEqual({
      kind: "picked",
      lineId: "item_rice",
      picked: 2,
    })
  })

  test.each([
    ["a UPC-A read as EAN-13, with a leading zero", "0036000291452"],
    ["a GTIN-14 with zero padding", "00036000291452"],
    ["surrounding whitespace", " 036000291452\n"],
  ])("matches %s", (_, scanned) => {
    expect(scanBarcode([rice, lantern], scanned)).toEqual({ kind: "picked", lineId: "item_lantern", picked: 1 })
  })

  test("matches non-numeric codes exactly, ignoring case", () => {
    const line = { ...cap, codes: ["ABC-123"] }
    expect(scanBarcode([line], "abc-123")).toEqual({ kind: "picked", lineId: "item_cap", picked: 1 })
    expect(scanBarcode([line], "ABC-1234")).toEqual({ kind: "not_in_order" })
  })

  test("warns when the barcode is on no line of the order", () => {
    expect(scanBarcode([rice, lantern, cap], "4006381333931")).toEqual({ kind: "not_in_order" })
    expect(scanBarcode([rice], "")).toEqual({ kind: "not_in_order" })
  })

  test("warns when every line with the barcode is already picked in full", () => {
    expect(scanBarcode([{ ...rice, picked: 2 }], "5901234123457")).toEqual({ kind: "already_picked", lineId: "item_rice" })
  })

  test("picks the next line still short when two lines share a barcode", () => {
    const first = { ...rice, id: "item_rice_1", quantity: 1, picked: 1 }
    const second = { ...rice, id: "item_rice_2", quantity: 1 }
    expect(scanBarcode([first, second], "5901234123457")).toEqual({ kind: "picked", lineId: "item_rice_2", picked: 1 })
  })

  test("leaves the units marked unavailable unpicked", () => {
    expect(scanBarcode([{ ...rice, picked: 1, unavailable: 1 }], "5901234123457")).toEqual({
      kind: "already_picked",
      lineId: "item_rice",
    })
  })
})

describe("pickProgress", () => {
  test("counts picked units against ordered units, and lists the lines still short", () => {
    expect(pickProgress([{ ...rice, picked: 1 }, lantern, { ...cap, picked: 1 }])).toEqual({
      picked: 2,
      total: 4,
      unavailable: 0,
      unpicked: ["item_rice", "item_lantern"],
      done: false,
      allUnavailable: false,
    })
  })

  test("is done once every line is picked in full", () => {
    expect(pickProgress([{ ...rice, picked: 2 }, { ...lantern, picked: 1 }])).toEqual({
      picked: 3,
      total: 3,
      unavailable: 0,
      unpicked: [],
      done: true,
      allUnavailable: false,
    })
  })

  test("counts units marked unavailable as no longer to pick, but not done until they are removed from the order", () => {
    expect(pickProgress([{ ...rice, picked: 1, unavailable: 1 }, { ...lantern, unavailable: 1 }])).toEqual({
      picked: 1,
      total: 3,
      unavailable: 2,
      unpicked: [],
      done: false,
      allUnavailable: false,
    })
  })

  test("says when every unit is marked unavailable: nothing would be left to send, so the order is cancelled instead (#17)", () => {
    expect(pickProgress([{ ...rice, unavailable: 2 }, { ...lantern, unavailable: 1 }]).allUnavailable).toBe(true)
    expect(pickProgress([{ ...rice, unavailable: 2 }, { ...lantern, picked: 1 }]).allUnavailable).toBe(false)
    expect(pickProgress([]).allUnavailable).toBe(false)
  })

  test("an order with no lines is not done", () => {
    expect(pickProgress([]).done).toBe(false)
  })
})

describe("pickBand", () => {
  test("counts the units picked out of those ordered, as words and as a fraction", () => {
    const progress = pickProgress([{ ...rice, picked: 2 }, { ...lantern, picked: 1 }, { ...cap, quantity: 2 }])
    expect(pickBand(progress)).toEqual({ label: "Picking · 3 of 5", fraction: 0.6 })
  })

  test("an order with nothing to pick has nothing done", () => {
    expect(pickBand(pickProgress([]))).toEqual({ label: "Picking · 0 of 0", fraction: 0 })
  })
})

describe("pickLineView", () => {
  test("a line picked in full turns its pill leaf", () => {
    expect(pickLineView({ ...rice, picked: 2, perishable: false })).toEqual({
      pill: { label: "2/2", tone: "picked" },
      note: "Picked",
      noteTone: "muted",
      spoken: "2 of 2 picked",
    })
  })

  test("a line with units marked short turns ember, saying so", () => {
    expect(pickLineView({ ...rice, unavailable: 1, perishable: true })).toEqual({
      pill: { label: "0/2", tone: "short" },
      note: "Perishable · 1 not available",
      noteTone: "ember",
      spoken: "Perishable, 0 of 2 picked, 1 not available",
    })
  })

  test("a line not yet touched asks for a tap", () => {
    expect(pickLineView({ ...lantern, perishable: false })).toEqual({
      pill: { label: "0/1", tone: "neutral" },
      note: "Tap to tick",
      noteTone: "muted",
      spoken: "0 of 1 picked",
    })
  })

  test("a line part picked says how many are picked", () => {
    expect(pickLineView({ ...rice, picked: 1, perishable: true })).toMatchObject({
      pill: { label: "1/2", tone: "neutral" },
      note: "Perishable · 1 of 2 picked",
      spoken: "Perishable, 1 of 2 picked",
    })
  })

  test("a line with no barcode is ticked by hand", () => {
    expect(pickLineView({ ...cap, perishable: false }).note).toBe("No barcode: tick by hand")
    expect(pickLineView({ ...cap, quantity: 2, picked: 1, perishable: false }).note).toBe("1 of 2 picked · No barcode: tick by hand")
  })
})

describe("parcelWeightLabel", () => {
  test("adds up each line's weight in grams times its quantity", () => {
    const items = [
      { quantity: 2, variant: { weight: 5000, product: { weight: 4000 } } },
      { quantity: "1", variant: { weight: "6000", product: null } },
    ]
    expect(parcelWeightLabel(items)).toBe("about 16 kg")
  })

  test("takes the product's weight when the variant has none", () => {
    expect(parcelWeightLabel([{ quantity: 3, variant: { weight: null, product: { weight: 250 } } }])).toBe("about 750 g")
  })

  test("rounds to a tenth of a kilo", () => {
    expect(parcelWeightLabel([{ quantity: 1, variant: { weight: 15_740 } }])).toBe("about 15.7 kg")
  })

  test("says nothing when no line has a weight", () => {
    expect(parcelWeightLabel([{ quantity: 1, variant: { weight: null, product: { weight: null } } }, { quantity: 1, variant: null }])).toBeNull()
    expect(parcelWeightLabel([])).toBeNull()
  })
})
