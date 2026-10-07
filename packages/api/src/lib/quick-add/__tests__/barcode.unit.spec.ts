import { readScannedBarcode } from "../barcode"

describe("readScannedBarcode", () => {
  it("looks a UPC-A up however the catalogue filed it, even when the camera read it as an EAN-13", () => {
    const read = readScannedBarcode("0036000291452")
    expect(read.ok && read.lookup).toEqual(["036000291452", "0036000291452", "00036000291452"])
  })

  it("looks an EAN-8 up as itself and in its longer forms", () => {
    const read = readScannedBarcode("96385074")
    expect(read.ok && read.lookup).toEqual(["96385074", "000096385074", "0000096385074", "00000096385074"])
  })

  it("files a new product's barcode as the catalogue import does", () => {
    const read = readScannedBarcode("2000000000114")
    expect(read.ok && read.barcode).toEqual({ barcode: "2000000000114", ean: "2000000000114" })
  })

  it("refuses a misread code rather than look up the wrong product", () => {
    expect(readScannedBarcode("2000000000115")).toEqual({ ok: false, error: 'Barcode "2000000000115" has a wrong check digit.' })
    expect(readScannedBarcode("hello")).toEqual({ ok: false, error: '"hello" is not a barcode.' })
  })
})
