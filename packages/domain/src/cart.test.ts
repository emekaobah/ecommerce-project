import { describe, expect, test } from "bun:test"
import { cartOnSignIn } from "./cart"

describe("cartOnSignIn", () => {
  test("carries a guest's cart with items over to the buyer", () => {
    expect(cartOnSignIn({ guestCart: { id: "cart_guest", itemCount: 2 }, buyerCartId: "cart_old" })).toEqual({
      kind: "adopt-guest",
      cartId: "cart_guest",
    })
  })

  test("carries a guest's cart over when the buyer has no cart yet", () => {
    expect(cartOnSignIn({ guestCart: { id: "cart_guest", itemCount: 1 }, buyerCartId: null })).toEqual({
      kind: "adopt-guest",
      cartId: "cart_guest",
    })
  })

  test("keeps the buyer's own cart when the guest emptied theirs", () => {
    expect(cartOnSignIn({ guestCart: { id: "cart_guest", itemCount: 0 }, buyerCartId: "cart_old" })).toEqual({
      kind: "keep-buyer",
      cartId: "cart_old",
    })
  })

  test("keeps the buyer's own cart when there is no guest cart", () => {
    expect(cartOnSignIn({ guestCart: null, buyerCartId: "cart_old" })).toEqual({ kind: "keep-buyer", cartId: "cart_old" })
  })

  test("leaves the buyer without a cart when neither has one worth keeping", () => {
    expect(cartOnSignIn({ guestCart: { id: "cart_guest", itemCount: 0 }, buyerCartId: null })).toEqual({
      kind: "keep-buyer",
      cartId: null,
    })
  })
})
