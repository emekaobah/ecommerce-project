import { suggestMapping } from "../../catalogue-import"
import { OFFER_IMPORT_FIELDS, offerMappingErrors } from "../fields"

describe("offer import fields", () => {
  it("suggests a mapping for a shop's own column names", () => {
    expect(suggestMapping(["Item", "EAN", "Price (₦)", "Unit cost", "Qty", "Notes"], OFFER_IMPORT_FIELDS)).toEqual({
      Item: "title",
      EAN: "barcode",
      "Price (₦)": "selling_price",
      "Unit cost": "cost_price",
      Qty: "stock",
    })
  })

  it("reads a column headed sale price as the selling price, and only an unmistakable discount column as the sale price", () => {
    for (const header of ["Sale price", "sale_price", "Selling/sale price", "Sales price"]) {
      expect(suggestMapping([header], OFFER_IMPORT_FIELDS)).toEqual({ [header]: "selling_price" })
    }
    for (const header of ["Discount price", "Promo price", "Discounted price (₦)", "Promotional price"]) {
      expect(suggestMapping(["Price", header], OFFER_IMPORT_FIELDS)).toEqual({ Price: "selling_price", [header]: "sale_price" })
    }
    // Which of the two a shop means is theirs to say: mapped by hand.
    expect(suggestMapping(["Price", "Sale price"], OFFER_IMPORT_FIELDS)).toEqual({ Price: "selling_price" })
    expect(suggestMapping(["Offer price"], OFFER_IMPORT_FIELDS)).toEqual({})
  })

  it("refuses a mapping with a field from two columns, an unknown field or a missing column", () => {
    expect(offerMappingErrors({ Name: "title", Item: "title", Colour: "colour", Price: "selling_price" }, ["Name", "Item", "Colour"])).toEqual([
      'Title is mapped from more than one column: "Name", "Item".',
      '"Colour" is mapped to an unknown field.',
      'The file has no column "Price".',
    ])
  })
})
