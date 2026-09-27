import { parseCsv } from "../csv"

describe("parseCsv", () => {
  it("reads headers and rows, keeping every cell as text", () => {
    expect(parseCsv("Title,Barcode,Price\nOfada Rice,0012345678905,14500\n")).toEqual({
      headers: ["Title", "Barcode", "Price"],
      rows: [["Ofada Rice", "0012345678905", "14500"]],
    })
  })

  it("reads quoted cells holding commas, quotes and line breaks", () => {
    const csv = 'Title,Description\r\n"Rice, 5kg","Stone-free ""ofada""\nfrom Abeokuta"\r\n'
    expect(parseCsv(csv).rows).toEqual([["Rice, 5kg", 'Stone-free "ofada"\nfrom Abeokuta']])
  })

  it("reads semicolon-separated exports with a byte-order mark, skipping blank lines", () => {
    expect(parseCsv("﻿Title;Price\n\nGarri;5200\n")).toEqual({ headers: ["Title", "Price"], rows: [["Garri", "5200"]] })
  })

  it("pads short rows to the header's width", () => {
    expect(parseCsv("Title,Price,Weight\nGarri,5200").rows).toEqual([["Garri", "5200", ""]])
  })
})
