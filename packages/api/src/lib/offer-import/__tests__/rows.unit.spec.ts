import { parseCsv } from "../../catalogue-import"
import { buildOfferImportRows, type OfferImportContext } from "../rows"

const context: OfferImportContext = {
  currency_code: "ngn",
  categories: [{ id: "pcat_rice", name: "Rice & Grains", handle: "rice-grains" }],
  variants: [
    { id: "variant_rice", product_id: "prod_rice", title: "Ofada Rice 5kg", published: true, codes: ["5901234123457"] },
  ],
  offers: [],
}

const MAPPING = { Name: "title", Barcode: "barcode", Price: "selling_price" }

const rowsOf = (csv: string, mapping: Record<string, string> = MAPPING, ctx: OfferImportContext = context) =>
  buildOfferImportRows(parseCsv(csv), mapping, ctx)

describe("buildOfferImportRows", () => {
  it("offers a catalogue product whose barcode the row carries, at the row's price", () => {
    const [row] = rowsOf('Name,Barcode,Price\nOfada rice,5901234123457,"₦14,500"\n')
    expect(row).toEqual({
      row: 2,
      title: "Ofada Rice 5kg",
      action: "offer",
      errors: [],
      warnings: [],
      offer: { variant_id: "variant_rice", product_id: "prod_rice", sku: "5901234123457", price: 14500, cost: null, stock: null },
      proposal: null,
    })
  })

  it("proposes a product the catalogue lacks, carrying whatever the sheet has, and offers it", () => {
    const [row] = rowsOf(
      "Name,Barcode,Price,Category,Weight,Image\nYam Flour 1kg,4006381333931,2300,Rice & Grains,1kg,https://example.com/yam.png\n",
      { ...MAPPING, Category: "category", Weight: "weight", Image: "images" }
    )
    expect(row).toEqual({
      row: 2,
      title: "Yam Flour 1kg",
      action: "propose",
      errors: [],
      warnings: [],
      offer: { variant_id: null, product_id: null, sku: "4006381333931", price: 2300, cost: null, stock: null },
      proposal: {
        title: "Yam Flour 1kg",
        categories: [{ id: "pcat_rice" }],
        weight: 1000,
        thumbnail: "https://example.com/yam.png",
        images: [{ url: "https://example.com/yam.png" }],
        variants: [{ title: "Yam Flour 1kg", barcode: "4006381333931", ean: "4006381333931" }],
      },
    })
  })

  describe("cost price and stock", () => {
    const COST_MAPPING = { ...MAPPING, Cost: "cost_price", Qty: "stock" }

    it("keeps the cost price and the stock count on the offer", () => {
      const [row] = rowsOf('Name,Barcode,Price,Cost,Qty\nRice,5901234123457,"₦14,500","₦12,000","1,200"\n', COST_MAPPING)
      expect(row.offer).toMatchObject({ price: 14500, cost: 12000, stock: 1200 })
      expect(row.warnings).toEqual([])
    })

    it("warns, without refusing the row, when the selling price is below cost", () => {
      const [row] = rowsOf("Name,Barcode,Price,Cost,Qty\nRice,5901234123457,1500,1800,\n", COST_MAPPING)
      expect(row.action).toBe("offer")
      expect(row.warnings).toEqual(["Selling price NGN 1,500 is below cost price NGN 1,800."])
    })

    it("leaves stock untracked when the cell is empty, and reads counts written with units", () => {
      const rows = rowsOf("Name,Barcode,Price,Cost,Qty\nA,,100,,\nB,,100,,12 pcs\nC,,100,,0\n", COST_MAPPING)
      expect(rows.map((r) => r.offer?.stock)).toEqual([null, 12, 0])
    })

    it("refuses a stock count that isn't a whole number of units", () => {
      const rows = rowsOf("Name,Barcode,Price,Cost,Qty\nA,,100,,lots\nB,,100,,-3\nC,,100,,2.5\n", COST_MAPPING)
      expect(rows.map((r) => r.errors)).toEqual([
        ['Qty: "lots" is not a stock count: use a whole number of units.'],
        ['Qty: "-3" is not a stock count: use a whole number of units.'],
        ['Qty: "2.5" is not a stock count: use a whole number of units.'],
      ])
      expect(rows.map((r) => r.action)).toEqual([null, null, null])
    })
  })

  describe("messy barcodes", () => {
    it("matches a barcode a spreadsheet wrote in scientific notation, saying how it read it", () => {
      const [row] = rowsOf("Name,Barcode,Price\nRice,5.901234123457E+12,100\n")
      expect(row).toMatchObject({ action: "offer", offer: { variant_id: "variant_rice" } })
      expect(row.warnings).toEqual(["Barcode: Barcode was in scientific notation; read it as 5901234123457."])
    })

    it("restores leading zeros a spreadsheet dropped", () => {
      const [row] = rowsOf("Name,Barcode,Price\nEgusi,12345678905,100\n")
      expect(row.proposal?.variants[0]).toMatchObject({ barcode: "0012345678905", ean: "0012345678905" })
    })

    it("refuses a barcode that lost digits, or whose check digit is wrong", () => {
      const rows = rowsOf("Name,Barcode,Price\nA,5.90123E+12,100\nB,5901234123458,100\n")
      expect(rows.map((r) => r.errors)).toEqual([
        [expect.stringMatching(/^Barcode: .*lost digits to scientific notation/)],
        ['Barcode: Barcode "5901234123458" has a wrong check digit.'],
      ])
    })
  })

  describe("rows that can't be imported", () => {
    it("needs a title or a barcode, and a selling price", () => {
      const rows = rowsOf("Name,Barcode,Price\n,,100\nRice,,\n")
      expect(rows.map((r) => r.errors)).toEqual([["Needs a title or a barcode."], ["Needs a selling price."]])
    })

    it("refuses a product the shop already sells, naming its offer", () => {
      const [row] = rowsOf("Name,Barcode,Price\nRice,5901234123457,100\n", MAPPING, {
        ...context,
        offers: [{ sku: "RICE-5KG", variant_id: "variant_rice" }],
      })
      expect(row.errors).toEqual(["You already sell Ofada Rice 5kg, as RICE-5KG."])
    })

    it("refuses a SKU the shop already uses or an earlier row took, and a barcode an earlier row took", () => {
      const rows = rowsOf(
        "Name,Barcode,SKU,Price\nA,,RICE-5KG,100\nB,4006381333931,B-1,100\nC,,B-1,100\nD,4006381333931,D-1,100\n",
        { ...MAPPING, SKU: "sku" },
        { ...context, offers: [{ sku: "RICE-5KG", variant_id: "variant_other" }] }
      )
      expect(rows.map((r) => r.errors)).toEqual([
        ["SKU: You already use RICE-5KG for another offer."],
        [],
        ["SKU: B-1 is already on row 3."],
        ["Barcode: 4006381333931 is already on row 3."],
      ])
    })

    it("refuses a barcode whose catalogue product is still being reviewed", () => {
      const [row] = rowsOf("Name,Barcode,Price\nRice,5901234123457,100\n", MAPPING, {
        ...context,
        variants: [{ ...context.variants[0], published: false }],
      })
      expect(row.errors).toEqual([
        "Barcode: 5901234123457 is on a product the catalogue is still reviewing; list it once it is published.",
      ])
    })
  })

  describe("long, hostile cells", () => {
    const timed = (run: () => unknown) => {
      const start = performance.now()
      run()
      return performance.now() - start
    }

    it("makes a SKU from a 200,000-character title in linear time, without leading or trailing dashes", () => {
      const title = `${"-".repeat(100_000)}${"a-".repeat(50_000)}${"!".repeat(50_000)}`
      let rows: ReturnType<typeof rowsOf> = []
      expect(timed(() => (rows = rowsOf(`Name,Price\n"${title}",100\n`, { Name: "title", Price: "selling_price" })))).toBeLessThan(500)
      expect(rows[0].offer?.sku).toMatch(/^A(-A)+$/)
      expect(rows[0].offer!.sku.length).toBeLessThanOrEqual(40)
    })

    it("reads a 100,000-character stock cell in linear time", () => {
      const stock = `1${",000".repeat(25_000)}x`
      let rows: ReturnType<typeof rowsOf> = []
      expect(timed(() => (rows = rowsOf(`Name,Price,Qty\nA,100,"${stock}"\n`, { Name: "title", Price: "selling_price", Qty: "stock" })))).toBeLessThan(500)
      expect(rows[0].errors).toEqual([expect.stringMatching(/is not a stock count/)])
    })
  })

  it("proposes a row with only a title and a price, under a SKU made from its title", () => {
    const [row] = rowsOf("Name,Price\nKilishi (200g),N3500\n", { Name: "title", Price: "selling_price" })
    expect(row).toMatchObject({
      action: "propose",
      errors: [],
      offer: { sku: "KILISHI-200G", price: 3500 },
      proposal: { title: "Kilishi (200g)", variants: [{ title: "Kilishi (200g)" }] },
    })
  })
})
