import { describe, expect, test } from "bun:test"
import { formatMoney } from "./money"
import { priceChangeMessage, type PriceChange } from "./price-change"

const ngn = (amount: number) => formatMoney(amount, "ngn")
const lantern = (was: Partial<PriceChange["was"]>, now: Partial<PriceChange["now"]>): PriceChange => ({
  line_item_id: "cali_1",
  product_title: "Rechargeable LED Lantern",
  variant_title: "Rechargeable LED Lantern",
  seller: { name: "Ikeja Gadget Hub" },
  was: { unit_price: 12000, compare_at_unit_price: null, is_tax_inclusive: true, ...was },
  now: { unit_price: 12000, compare_at_unit_price: null, is_tax_inclusive: true, ...now },
})

describe("priceChangeMessage", () => {
  test("a shop's new price, against what the buyer added it at", () => {
    expect(priceChangeMessage(lantern({}, { unit_price: 13000 }), "ngn")).toBe(
      `Rechargeable LED Lantern from Ikeja Gadget Hub is now ${ngn(13000)} each (was ${ngn(12000)}).`
    )
  })

  test("a sale that ended", () => {
    expect(priceChangeMessage(lantern({ unit_price: 11200, compare_at_unit_price: 12000 }, {}), "ngn")).toBe(
      `Rechargeable LED Lantern from Ikeja Gadget Hub is now ${ngn(12000)} each (was ${ngn(11200)}): the sale ended.`
    )
  })

  test("a sale that started", () => {
    expect(priceChangeMessage(lantern({}, { unit_price: 11200, compare_at_unit_price: 12000 }), "ngn")).toBe(
      `Rechargeable LED Lantern from Ikeja Gadget Hub is now ${ngn(11200)} each (was ${ngn(12000)}): it's on sale.`
    )
  })

  test("VAT no longer included in the price", () => {
    expect(priceChangeMessage(lantern({}, { is_tax_inclusive: false }), "ngn")).toBe(
      `Rechargeable LED Lantern from Ikeja Gadget Hub is now ${ngn(12000)} each plus VAT (was VAT included).`
    )
  })

  test("a sale price that stayed while the shop's normal price changed", () => {
    expect(
      priceChangeMessage(
        lantern({ unit_price: 11200, compare_at_unit_price: 12000 }, { unit_price: 11200, compare_at_unit_price: 13000 }),
        "ngn"
      )
    ).toBe(`Rechargeable LED Lantern from Ikeja Gadget Hub is still ${ngn(11200)} each, down from ${ngn(13000)}.`)
  })

  test("names the variant when it differs from the product", () => {
    const kaftan = { ...lantern({}, { unit_price: 13000 }), product_title: "Adire Kaftan", variant_title: "M" }
    expect(priceChangeMessage(kaftan, "ngn")).toStartWith("Adire Kaftan (M) from Ikeja Gadget Hub is now")
  })
})
