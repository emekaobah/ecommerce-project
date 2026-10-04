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

  it("refuses a mapping with a field from two columns, an unknown field or a missing column", () => {
    expect(offerMappingErrors({ Name: "title", Item: "title", Colour: "colour", Price: "selling_price" }, ["Name", "Item", "Colour"])).toEqual([
      'Title is mapped from more than one column: "Name", "Item".',
      '"Colour" is mapped to an unknown field.',
      'The file has no column "Price".',
    ])
  })
})
