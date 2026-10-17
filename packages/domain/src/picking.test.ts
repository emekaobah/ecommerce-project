import { describe, expect, test } from "bun:test"
import { pickProgress, scanBarcode, type PickLine } from "./picking"

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
