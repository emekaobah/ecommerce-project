import { describe, expect, test } from "bun:test"
import { shopChoice } from "./shop-choice"

const grocery = { seller_id: "sel_grocery", seller: { name: "Iya Bisi Foodstuff" } }
const fashion = { seller_id: "sel_fashion", seller: { name: "Adire House" } }
const electronics = { seller_id: "sel_electronics", seller: { name: "Musa Electronics" } }

describe("shopChoice", () => {
  test("goes straight into the only shop a member belongs to", () => {
    expect(shopChoice([grocery])).toEqual({ kind: "only", sellerId: "sel_grocery" })
  })

  test("asks a member of several shops to pick one, listed by name", () => {
    expect(shopChoice([grocery, electronics, fashion])).toEqual({
      kind: "pick",
      shops: [fashion, grocery, electronics],
    })
  })

  test("says so when the member belongs to no shop", () => {
    expect(shopChoice([])).toEqual({ kind: "none" })
  })
})
