import { describe, expect, test } from "bun:test"
import { cartOnSignIn } from "./cart"

const guest = (itemCount: number) => ({ id: "cart_guest", itemCount })
const buyer = (itemCount: number) => ({ id: "cart_buyer", itemCount })

describe("cartOnSignIn", () => {
  test("merges a guest's items into the buyer's own cart when both hold items", () => {
    expect(cartOnSignIn({ guestCart: guest(2), buyerCart: buyer(1) })).toEqual({
      kind: "merge",
      cartId: "cart_buyer",
      fromCartId: "cart_guest",
    })
  })

  test("carries a guest's cart over when the buyer has no cart yet", () => {
    expect(cartOnSignIn({ guestCart: guest(1), buyerCart: null })).toEqual({ kind: "adopt-guest", cartId: "cart_guest" })
  })

  test("carries a guest's cart over when the buyer's own cart is empty", () => {
    expect(cartOnSignIn({ guestCart: guest(1), buyerCart: buyer(0) })).toEqual({ kind: "adopt-guest", cartId: "cart_guest" })
  })

  test("keeps the buyer's own cart when the guest emptied theirs", () => {
    expect(cartOnSignIn({ guestCart: guest(0), buyerCart: buyer(3) })).toEqual({ kind: "keep-buyer", cartId: "cart_buyer" })
  })

  test("keeps the buyer's own cart when there is no guest cart", () => {
    expect(cartOnSignIn({ guestCart: null, buyerCart: buyer(0) })).toEqual({ kind: "keep-buyer", cartId: "cart_buyer" })
  })

  test("leaves the buyer without a cart when neither has one", () => {
    expect(cartOnSignIn({ guestCart: guest(0), buyerCart: null })).toEqual({ kind: "keep-buyer", cartId: null })
  })
})
