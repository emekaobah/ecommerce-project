import { describe, expect, test } from "bun:test"
import { CANCEL_REASON_LABELS, cancelReasonText } from "./cancellation"
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
