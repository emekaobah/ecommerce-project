import { describe, expect, test } from "bun:test"
import { shopInitials } from "./shop-mark"

describe("shopInitials", () => {
  test.each([
    ["Iya Bisi Foodstuff", "IB"],
    ["adire house", "AH"],
    ["Mama & Sons Provisions", "MS"],
    ["  Lagos   Grocery ", "LG"],
    ["Ọjà Ẹ̀wà", "ỌẸ"],
    ["24/7 Mart", "2M"],
  ])("%s reads %s", (name, initials) => {
    expect(shopInitials(name)).toBe(initials)
  })

  test("a one-word name takes its first two letters", () => {
    expect(shopInitials("Kolawole")).toBe("KO")
  })
})
