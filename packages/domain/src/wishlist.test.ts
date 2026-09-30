import { describe, expect, test } from "bun:test"
import { isSaved, moveToCart } from "./wishlist"

const rice = { id: "off_rice" }
const small = { id: "off_kaftan_s" }
const large = { id: "off_kaftan_l" }

describe("moveToCart", () => {
  test("moves a product the shop sells in one variant straight into the cart", () => {
    expect(moveToCart({ listing: { offers: [rice] } })).toEqual({ kind: "move", offerId: "off_rice" })
  })

  test("asks the buyer to choose when the shop sells it in several variants", () => {
    expect(moveToCart({ listing: { offers: [small, large] } })).toEqual({ kind: "choose" })
  })

  test("says so when the shop no longer sells it in the buyer's region", () => {
    expect(moveToCart({ listing: null })).toEqual({ kind: "unavailable" })
    expect(moveToCart({ listing: { offers: [] } })).toEqual({ kind: "unavailable" })
  })
})

describe("isSaved", () => {
  const items = [{ product: { id: "prod_lantern" }, seller_id: "sel_gadgets" }]

  test("is saved when the buyer saved the product from this shop", () => {
    expect(isSaved(items, "sel_gadgets", "prod_lantern")).toBe(true)
  })

  test("is not saved from another shop, since the wishlist keeps the shop it was saved from", () => {
    expect(isSaved(items, "sel_grocer", "prod_lantern")).toBe(false)
    expect(isSaved(items, "sel_gadgets", "prod_rice")).toBe(false)
  })
})
