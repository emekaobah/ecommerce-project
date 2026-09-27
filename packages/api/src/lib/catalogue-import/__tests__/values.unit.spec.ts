import { parseBarcode, parseLength, parsePrice, parseWeight } from "../values"

describe("parseBarcode", () => {
  it("files a 13-digit GTIN as the EAN, keeping its leading zero", () => {
    expect(parseBarcode("0012345678905")).toEqual({ ok: true, value: { barcode: "0012345678905", ean: "0012345678905" } })
  })

  it("files a 12-digit GTIN as the UPC and an 8-digit one as the EAN", () => {
    expect(parseBarcode("036000291452")).toEqual({ ok: true, value: { barcode: "036000291452", upc: "036000291452" } })
    expect(parseBarcode("96385074")).toEqual({ ok: true, value: { barcode: "96385074", ean: "96385074" } })
  })

  it("reads a GTIN-14 with a zero indicator as its EAN", () => {
    expect(parseBarcode("05901234123457")).toEqual({
      ok: true,
      value: { barcode: "05901234123457", ean: "5901234123457" },
    })
  })

  it("ignores spaces and hyphens", () => {
    expect(parseBarcode(" 590-1234 123457 ")).toMatchObject({ ok: true, value: { ean: "5901234123457" } })
  })

  it("converts an ISBN-10 to its EAN", () => {
    expect(parseBarcode("0-306-40615-2")).toEqual({ ok: true, value: { barcode: "9780306406157", ean: "9780306406157" } })
  })

  it("refuses a code whose check digit is wrong", () => {
    expect(parseBarcode("5901234123458")).toEqual({ ok: false, error: expect.stringContaining("check digit") })
  })

  it("refuses an Amazon-only ASIN, which has no EAN or UPC", () => {
    expect(parseBarcode("B08N5WRWNW")).toEqual({ ok: false, error: expect.stringContaining("ASIN") })
  })

  describe("spreadsheet damage", () => {
    it("recovers a barcode in scientific notation when no digits were lost", () => {
      expect(parseBarcode("5.901234123457E+12")).toEqual({
        ok: true,
        value: { barcode: "5901234123457", ean: "5901234123457" },
        warning: expect.stringContaining("scientific notation"),
      })
    })

    it("refuses a barcode in scientific notation that lost digits", () => {
      expect(parseBarcode("5.90123E+12")).toEqual({ ok: false, error: expect.stringContaining("as text") })
    })

    it("restores leading zeros a spreadsheet dropped, when the check digit confirms it", () => {
      expect(parseBarcode("12345678905")).toEqual({
        ok: true,
        value: { barcode: "0012345678905", ean: "0012345678905" },
        warning: expect.stringContaining("leading zeros"),
      })
    })

    it("drops a trailing .0 from a number-formatted cell", () => {
      expect(parseBarcode("5901234123457.0")).toMatchObject({ ok: true, value: { ean: "5901234123457" } })
    })
  })

  it("refuses text that is not a barcode", () => {
    expect(parseBarcode("n/a")).toEqual({ ok: false, error: expect.stringContaining("not a barcode") })
  })
})

describe("parseWeight", () => {
  it.each([
    ["1.5kg", 1500],
    ["300g", 300],
    ["300 G", 300],
    ["2 lb", 907],
    ["12oz", 340],
    ["1,5 kg", 1500],
    ["1,200g", 1200],
    ["450", 450],
  ])("reads %s as %s grams", (input, grams) => {
    expect(parseWeight(input)).toEqual({ ok: true, value: grams })
  })

  it("refuses an unknown unit or a non-positive weight", () => {
    expect(parseWeight("3 bags")).toEqual({ ok: false, error: expect.stringContaining("weight") })
    expect(parseWeight("0kg")).toEqual({ ok: false, error: expect.stringContaining("weight") })
  })
})

describe("parseLength", () => {
  it.each([
    ["30cm", 30],
    ["300 mm", 30],
    ["1.2m", 120],
    ["12in", 30.5],
    ['12"', 30.5],
    ["25", 25],
  ])("reads %s as %s cm", (input, cm) => {
    expect(parseLength(input)).toEqual({ ok: true, value: cm })
  })

  it("refuses a weight given as a dimension", () => {
    expect(parseLength("2kg")).toEqual({ ok: false, error: expect.stringContaining("length") })
  })
})

describe("parsePrice", () => {
  it.each([
    ["₦1,500", 1500],
    ["NGN 14,500.50", 14500.5],
    ["N2500", 2500],
    ["1500", 1500],
  ])("reads %s as %s", (input, amount) => {
    expect(parsePrice(input)).toEqual({ ok: true, value: amount })
  })

  it("refuses text and non-positive prices", () => {
    expect(parsePrice("call us")).toEqual({ ok: false, error: expect.stringContaining("price") })
    expect(parsePrice("0")).toEqual({ ok: false, error: expect.stringContaining("price") })
  })
})
