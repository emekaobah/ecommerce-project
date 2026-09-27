import { importFields, normaliseHeader, suggestMapping, type CatalogueAttribute } from "../fields"

const storage: CatalogueAttribute = {
  id: "attr_storage",
  name: "Storage",
  handle: "storage",
  type: "single_select",
  is_variant_axis: false,
  values: [{ id: "val_cool", name: "Cool, dry place" }],
}
const shelfLife: CatalogueAttribute = { id: "attr_shelf", name: "Shelf life", handle: "shelf-life", type: "text", is_variant_axis: false, values: [] }
const colour: CatalogueAttribute = { id: "attr_colour", name: "Colour", handle: "colour", type: "multi_select", is_variant_axis: true, values: [] }

describe("importFields", () => {
  it("offers the product, variant and offer fields, then each category attribute", () => {
    const keys = importFields([storage, shelfLife]).map((f) => f.key)
    expect(keys).toEqual(
      expect.arrayContaining(["title", "description", "category", "images", "weight", "length", "sku", "barcode", "selling_price"])
    )
    expect(keys.slice(-2)).toEqual(["attribute:attr_storage", "attribute:attr_shelf"])
  })

  it("leaves out variant-axis attributes, which an import of single-variant rows can't fill", () => {
    expect(importFields([colour]).map((f) => f.key)).not.toContain("attribute:attr_colour")
  })
})

describe("suggestMapping", () => {
  it("matches headers to fields by name, whatever their case and punctuation", () => {
    const fields = importFields([storage, shelfLife])
    expect(
      suggestMapping(["Product Name", "GTIN", "Retail price (₦)", "Weight (kg)", "Shelf-life", "STORAGE", "Supplier"], fields)
    ).toEqual({
      "Product Name": "title",
      GTIN: "barcode",
      "Retail price (₦)": "selling_price",
      "Weight (kg)": "weight",
      "Shelf-life": "attribute:attr_shelf",
      STORAGE: "attribute:attr_storage",
    })
  })

  it.each(["EAN", "UPC", "ISBN", "ASIN", "Barcode"])("maps a %s column to the barcode", (header) => {
    expect(suggestMapping([header], importFields([]))).toEqual({ [header]: "barcode" })
  })

  it("maps a field to one column only", () => {
    expect(suggestMapping(["EAN", "UPC"], importFields([]))).toEqual({ EAN: "barcode" })
  })
})

describe("normaliseHeader", () => {
  it("drops a bracketed unit", () => {
    expect(normaliseHeader("Retail price (₦)")).toBe("retail price")
    expect(normaliseHeader("Weight [kg]")).toBe("weight")
  })

  // Headers come from an uploaded file: unclosed brackets must not make it quadratic.
  it("reads a huge run of unclosed brackets in linear time", () => {
    const header = "(".repeat(100_000) + "[".repeat(100_000)
    const started = performance.now()
    normaliseHeader(header)
    expect(performance.now() - started).toBeLessThan(250)
  })
})
