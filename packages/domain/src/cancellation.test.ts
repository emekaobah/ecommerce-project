import { describe, expect, test } from "bun:test"
import { CANCEL_REASON_LABELS, cancelledBy, cancelReasonText, cancelRequest } from "./cancellation"
import { CANCEL_REASONS } from "./fulfilment"

describe("cancel reasons", () => {
  test("each has the label staff pick it by", () => {
    expect(CANCEL_REASONS.map((reason) => CANCEL_REASON_LABELS[reason])).toEqual([
      "Items unavailable",
      "Shop can't fulfil this order",
      "Buyer asked to cancel",
      "Other",
    ])
  })
})

describe("cancelReasonText", () => {
  test("is the reason's label, as the buyer is shown it", () => {
    expect(cancelReasonText({ reason: "cannot_fulfil", note: null })).toBe("Shop can't fulfil this order")
  })

  test("is the note staff wrote for another reason", () => {
    expect(cancelReasonText({ reason: "other", note: "Our freezer broke down" })).toBe("Our freezer broke down")
  })

  test("adds a note given with a listed reason", () => {
    expect(cancelReasonText({ reason: "items_unavailable", note: "The rice is sold out" })).toBe(
      "Items unavailable: The rice is sold out"
    )
  })
})

describe("cancelledBy", () => {
  test("is Oja's team for an operator", () => {
    expect(cancelledBy("operator")).toBe("Oja's team")
    expect(cancelledBy("operator", "Mama Put Groceries")).toBe("Oja's team")
  })

  test("is the shop, by name when given", () => {
    expect(cancelledBy("seller")).toBe("the shop")
    expect(cancelledBy("seller", "Mama Put Groceries")).toBe("Mama Put Groceries")
  })
})

describe("cancelRequest", () => {
  test("is nothing until staff pick a reason", () => {
    expect(cancelRequest({ reason: null, note: "" })).toBeNull()
  })

  test("is nothing for another reason until staff say what it is", () => {
    expect(cancelRequest({ reason: "other", note: "   " })).toBeNull()
  })

  test("sends another reason with its note, trimmed", () => {
    expect(cancelRequest({ reason: "other", note: "  Our freezer broke down " })).toEqual({
      reason: "other",
      note: "Our freezer broke down",
    })
  })

  test("sends a listed reason on its own, leaving out a blank note", () => {
    expect(cancelRequest({ reason: "buyer_asked", note: " " })).toEqual({ reason: "buyer_asked" })
    expect(cancelRequest({ reason: "buyer_asked", note: "They called the shop" })).toEqual({
      reason: "buyer_asked",
      note: "They called the shop",
    })
  })
})
