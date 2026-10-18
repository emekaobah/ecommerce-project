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

  it("reads tab-separated exports and old Mac line endings", () => {
    expect(parseCsv("Title\tPrice\rGarri\t5200\rBeans\t3100")).toEqual({
      headers: ["Title", "Price"],
      rows: [
        ["Garri", "5200"],
        ["Beans", "3100"],
      ],
    })
  })

  it("trims every cell, quoted or not", () => {
    expect(parseCsv('Title , Price\n  Garri ,"  5200 "\n')).toEqual({ headers: ["Title", "Price"], rows: [["Garri", "5200"]] })
  })

  it("keeps an empty last cell after a trailing delimiter", () => {
    expect(parseCsv("Title,Price\nGarri,").rows).toEqual([["Garri", ""]])
  })

  it("reads an empty file as no headers and no rows", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] })
    expect(parseCsv("﻿\n\n")).toEqual({ headers: [], rows: [] })
  })
})
