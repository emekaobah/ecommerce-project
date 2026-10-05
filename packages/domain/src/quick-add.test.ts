import { describe, expect, test } from "bun:test"
import { quickAddForm } from "./quick-add"

describe("quickAddForm", () => {
  test("reads the price and stock staff type for a catalogue product", () => {
    expect(quickAddForm({ price: "2,500", stock: "12" }, { newProduct: false })).toEqual({
      ok: true,
      value: { price: 2500, stock: 12 },
    })
  })

  test("leaves stock untracked when it is left empty", () => {
    expect(quickAddForm({ price: "1500.50", stock: " " }, { newProduct: false })).toEqual({
      ok: true,
      value: { price: 1500.5, stock: null },
    })
  })

  test("needs a name and a photo for a product the catalogue lacks", () => {
    expect(quickAddForm({ price: "900", stock: "", title: " Kilishi 100g ", hasPhoto: true }, { newProduct: true })).toEqual({
      ok: true,
      value: { price: 900, stock: null, title: "Kilishi 100g" },
    })
    expect(quickAddForm({ price: "900", stock: "", title: "", hasPhoto: false }, { newProduct: true })).toEqual({
      ok: false,
      errors: { title: "Enter the product's name.", photo: "Take a photo of the product." },
    })
  })

  test("says what is wrong with a price or stock that can't be read", () => {
    expect(quickAddForm({ price: "", stock: "" }, { newProduct: false })).toEqual({
      ok: false,
      errors: { price: "Enter a price." },
    })
    expect(quickAddForm({ price: "0", stock: "2.5" }, { newProduct: false })).toEqual({
      ok: false,
      errors: { price: "Enter a price above zero.", stock: "Enter a whole number of items, or leave it empty." },
    })
    expect(quickAddForm({ price: "abc", stock: "-1" }, { newProduct: false })).toEqual({
      ok: false,
      errors: { price: "Enter a price above zero.", stock: "Enter a whole number of items, or leave it empty." },
    })
  })
})
