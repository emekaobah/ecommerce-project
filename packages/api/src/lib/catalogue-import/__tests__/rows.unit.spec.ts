import { parseCsv } from "../csv"
import type { CatalogueAttribute } from "../fields"
import { buildImportRows, mappingErrors, type ImportCatalogue } from "../rows"

const storage: CatalogueAttribute = {
  id: "attr_storage",
  name: "Storage",
  handle: "storage",
  type: "single_select",
  is_variant_axis: false,
  values: [
    { id: "val_cool", name: "Cool, dry place" },
    { id: "val_fridge", name: "Refrigerate" },
  ],
}
const halal: CatalogueAttribute = { id: "attr_halal", name: "Halal", handle: "halal", type: "toggle", is_variant_axis: false, values: [] }

const catalogue: ImportCatalogue = {
  currency_code: "ngn",
  categories: [
    { id: "pcat_groceries", name: "Groceries", handle: "groceries" },
    { id: "pcat_rice", name: "Rice & Grains", handle: "rice-grains" },
  ],
  attributes: [storage, halal],
  existing: { skus: ["TAKEN-SKU"], barcodes: ["5901234123457"] },
}

const MAPPING = {
  Name: "title",
  Barcode: "barcode",
  Price: "selling_price",
  Category: "category",
  Weight: "weight",
  Storage: "attribute:attr_storage",
}

const rowsOf = (csv: string, mapping: Record<string, string> = MAPPING, cat: ImportCatalogue = catalogue) =>
  buildImportRows(parseCsv(csv), mapping, cat)

describe("buildImportRows", () => {
  it("turns a row into a draft single-variant product, with the price kept for the shops' offers", () => {
    const [row] = rowsOf(
      'Name,Barcode,Price,Category,Weight,Storage\nOfada Rice 5kg,0012345678905,"₦14,500",Rice & Grains,5kg,"cool, dry place"\n'
    )
    expect(row).toEqual({
      row: 2,
      title: "Ofada Rice 5kg",
      errors: [],
      warnings: [],
      product: {
        title: "Ofada Rice 5kg",
        status: "draft",
        categories: [{ id: "pcat_rice" }],
        weight: 5000,
        attributes: [{ id: "attr_storage", value_ids: ["val_cool"] }],
        variants: [
          {
            title: "Ofada Rice 5kg",
            barcode: "0012345678905",
            ean: "0012345678905",
            metadata: { import_price: { amount: 14500, currency_code: "ngn" } },
          },
        ],
      },
    })
  })

  it("refuses a row with neither a title nor a barcode, or without a selling price", () => {
    const rows = rowsOf("Name,Barcode,Price\n,,1500\nGarri,,\n", { Name: "title", Barcode: "barcode", Price: "selling_price" })
    expect(rows.map((r) => [r.row, r.product, r.errors])).toEqual([
      [2, null, ["Needs a title or a barcode."]],
      [3, null, ["Needs a selling price."]],
    ])
  })

  it("titles a barcode-only row with its barcode until enrichment names it", () => {
    const [row] = rowsOf("Barcode,Price\n036000291452,900\n", { Barcode: "barcode", Price: "selling_price" })
    expect(row.errors).toEqual([])
    expect(row.product?.title).toBe("036000291452")
    expect(row.warnings).toEqual([expect.stringContaining("No title")])
  })

  it("names the column of each cell it can't read, and creates nothing for the row", () => {
    const [row] = rowsOf("Name,Barcode,Price,Category,Weight,Storage\nBeans,5.90123E+12,cheap,Shoes,3 bags,Hot\n")
    expect(row.product).toBeNull()
    expect(row.errors).toEqual([
      expect.stringMatching(/^Barcode: .*scientific notation/),
      expect.stringMatching(/^Price: .*not a price/),
      expect.stringMatching(/^Category: .*"Shoes"/),
      expect.stringMatching(/^Weight: .*not a weight/),
      expect.stringMatching(/^Storage: "Hot" .*Cool, dry place, Refrigerate/),
    ])
  })

  it("repairs a barcode a spreadsheet mangled, with a warning", () => {
    const [row] = rowsOf("Name,Barcode,Price\nGarri,12345678905,5200\n", { Name: "title", Barcode: "barcode", Price: "selling_price" })
    expect(row.product?.variants[0]).toMatchObject({ ean: "0012345678905" })
    expect(row.warnings).toEqual([expect.stringMatching(/^Barcode: .*leading zeros/)])
  })

  it("reads bare numbers in the unit a column's header names", () => {
    const [row] = rowsOf("Name,Price,Weight (kg),Length [mm]\nGarri,5200,1.5,300\n", {
      Name: "title",
      Price: "selling_price",
      "Weight (kg)": "weight",
      "Length [mm]": "length",
    })
    expect(row.product).toMatchObject({ weight: 1500, length: 30 })
  })

  it("finds a category by handle or by its path", () => {
    const rows = rowsOf("Name,Price,Category\nA,1,rice-grains\nB,1,Groceries > Rice & Grains\n", {
      Name: "title",
      Price: "selling_price",
      Category: "category",
    })
    expect(rows.map((r) => r.product?.categories)).toEqual([[{ id: "pcat_rice" }], [{ id: "pcat_rice" }]])
  })

  it("takes image URLs separated by commas, pipes or spaces, the first as thumbnail", () => {
    const [row] = rowsOf('Name,Price,Images\nA,1,"https://img.test/a.png | https://img.test/b.png"\n', {
      Name: "title",
      Price: "selling_price",
      Images: "images",
    })
    expect(row.product).toMatchObject({
      thumbnail: "https://img.test/a.png",
      images: [{ url: "https://img.test/a.png" }, { url: "https://img.test/b.png" }],
    })
    const [bad] = rowsOf("Name,Price,Images\nA,1,a.png\n", { Name: "title", Price: "selling_price", Images: "images" })
    expect(bad.errors).toEqual([expect.stringMatching(/^Images: "a.png" is not a web address/)])
  })

  it("reads yes/no into a toggle attribute", () => {
    const [row] = rowsOf("Name,Price,Halal\nSuya,1,Yes\n", { Name: "title", Price: "selling_price", Halal: "attribute:attr_halal" })
    expect(row.product?.attributes).toEqual([{ id: "attr_halal", value: true }])
  })

  it("refuses a SKU or barcode the catalogue or an earlier row already holds", () => {
    const rows = rowsOf(
      "Name,SKU,Barcode,Price\nA,TAKEN-SKU,,1\nB,,5901234123457,1\nC,NEW-1,036000291452,1\nD,NEW-1,036000291452,1\n",
      { Name: "title", SKU: "sku", Barcode: "barcode", Price: "selling_price" }
    )
    expect(rows.map((r) => r.errors)).toEqual([
      ["SKU: TAKEN-SKU is already in the catalogue."],
      ["Barcode: 5901234123457 is already in the catalogue."],
      [],
      ["SKU: NEW-1 is already on row 4.", "Barcode: 036000291452 is already on row 4."],
    ])
  })
})

describe("mappingErrors", () => {
  it("reports a field mapped from two columns, an unknown field, and a column not in the file", () => {
    expect(
      mappingErrors({ Name: "title", Product: "title", Colour: "attribute:nope", Missing: "sku" }, ["Name", "Product", "Colour"], catalogue)
    ).toEqual([
      'Title is mapped from more than one column: "Name", "Product".',
      '"Colour" is mapped to an unknown field.',
      'The file has no column "Missing".',
    ])
  })
})
