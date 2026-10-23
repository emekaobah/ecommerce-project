import { describe, expect, test } from "bun:test"
import { cancelledNote, rejectedNote } from "./staff-order-notes"

describe("rejectedNote", () => {
  test("rejected by the shop, with its reason as a sentence", () => {
    expect(rejectedNote({ rejected_by: "seller", reject_reason: "Out of stock" })).toBe(
      "Rejected: Out of stock. The buyer's payment for this order is being refunded."
    )
  })

  test("not accepted before its deadline", () => {
    expect(rejectedNote({ rejected_by: "accept_deadline", reject_reason: null })).toBe(
      "Not accepted in time. The buyer's payment for this order is being refunded."
    )
  })
})

describe("cancelledNote", () => {
  test("cancelled by the shop, with its reason", () => {
    expect(cancelledNote({ by: "seller", reason: "items_unavailable", note: null })).toBe(
      "Cancelled by the shop: Items unavailable. The buyer is refunded all they paid for it."
    )
  })

  test("cancelled by Oja's team, with the note they wrote", () => {
    expect(cancelledNote({ by: "operator", reason: "other", note: "Duplicate order!" })).toBe(
      "Cancelled by Oja's team: Duplicate order! The buyer is refunded all they paid for it."
    )
  })
})
