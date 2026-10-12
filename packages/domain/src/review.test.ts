import { describe, expect, test } from "bun:test"
import type { FulfilmentState } from "./fulfilment"
import { canReview, ratingSummary, reviewerName, reviewAction, reviewForm, reviewStatus, reviewTitle } from "./review"

describe("canReview", () => {
  test("lets the buyer review a shop's order once it is delivered", () => {
    expect(canReview("delivered")).toBe(true)
  })

  test("refuses every state before the buyer has the order, and a rejected order", () => {
    const before: FulfilmentState[] = [
      "new",
      "accepted",
      "rejected",
      "picking",
      "partially_available",
      "packed",
      "label_booked",
      "courier_confirmed",
      "handed_to_courier",
      "in_transit",
    ]
    for (const state of before) expect(canReview(state)).toBe(false)
  })
})

const shopReview = { id: "rev_shop", reference: "seller" as const, reference_id: "sel_grocer", rating: 4, customer_note: "Fresh" }
const riceReview = { id: "rev_rice", reference: "product" as const, reference_id: "prod_rice", rating: 5, customer_note: null }

describe("reviewForm", () => {
  const order = {
    can_review: true,
    seller: { id: "sel_grocer", name: "Mama Put Groceries" },
    items: [
      { product_id: "prod_rice", product_title: "Ofada Rice 5kg", quantity: 2 },
      { product_id: "prod_rice", product_title: "Ofada Rice 5kg", quantity: 1 },
      { product_id: "prod_oil", product_title: "Palm Oil 1L", quantity: 0 },
      { product_id: null, product_title: "Deleted product", quantity: 1 },
    ],
    reviews: [],
  }

  test("offers the shop, then each product the buyer received once, as the order lists them", () => {
    expect(reviewForm(order)).toEqual([
      { reference: "seller", reference_id: "sel_grocer", title: "Mama Put Groceries", review: null },
      { reference: "product", reference_id: "prod_rice", title: "Ofada Rice 5kg", review: null },
    ])
  })

  test("carries the buyer's review of each, whichever order they wrote it on, to edit", () => {
    expect(reviewForm({ ...order, reviews: [shopReview] }).map((t) => t.review?.id ?? null)).toEqual(["rev_shop", null])
  })

  test("asks the buyer to review a received order, and to edit once every review is written", () => {
    expect(reviewAction(order)).toBe("write")
    expect(reviewAction({ ...order, reviews: [shopReview] })).toBe("write")
    expect(reviewAction({ ...order, reviews: [shopReview, riceReview] })).toBe("edit")
  })

  test("asks nothing until the order is received", () => {
    expect(reviewAction({ ...order, can_review: false })).toBeNull()
    expect(reviewAction({ ...order, can_review: false, reviews: [shopReview] })).toBeNull()
  })
})

describe("reviewTitle", () => {
  const order = {
    seller: { id: "sel_grocer", name: "Mama Put Groceries" },
    items: [{ product_id: "prod_rice", product_title: "Ofada Rice 5kg", quantity: 2 }],
    reviews: [],
  }

  test("names a review of the shop by the shop, and of a product by the product", () => {
    expect(reviewTitle(order, { reference: "seller", reference_id: "sel_grocer" })).toBe("Mama Put Groceries")
    expect(reviewTitle(order, { reference: "product", reference_id: "prod_rice" })).toBe("Ofada Rice 5kg")
  })
})

describe("reviewerName", () => {
  test("shows a reviewer by first name and last initial", () => {
    expect(reviewerName({ first_name: "Ada", last_name: "Obi" })).toBe("Ada O.")
  })

  test("shows the first name alone without a last name", () => {
    expect(reviewerName({ first_name: "Ada", last_name: null })).toBe("Ada")
    expect(reviewerName({ first_name: " Ada ", last_name: " " })).toBe("Ada")
  })

  test("calls a reviewer with no name a buyer", () => {
    expect(reviewerName({ first_name: null, last_name: "Obi" })).toBe("A buyer")
    expect(reviewerName(null)).toBe("A buyer")
  })
})

describe("ratingSummary", () => {
  test("shows the average to one decimal place with how many reviews it is of", () => {
    expect(ratingSummary({ average: 4.25, count: 12 })).toBe("4.3 · 12 reviews")
    expect(ratingSummary({ average: 5, count: 1 })).toBe("5.0 · 1 review")
  })

  test("says when there are no reviews yet", () => {
    expect(ratingSummary({ average: null, count: 0 })).toBe("No reviews yet")
  })
})

describe("reviewStatus", () => {
  test("tells the author a pending review waits for moderation", () => {
    expect(reviewStatus("pending")).toEqual({
      label: "Waiting for moderation",
      tone: "warning",
      note: "We check every review before it's published. Other buyers will see it once it is.",
    })
  })

  test("tells the author a review is published, or that it wasn't", () => {
    expect(reviewStatus("published")).toMatchObject({ label: "Published", tone: "success" })
    expect(reviewStatus("rejected")).toMatchObject({ label: "Not published", tone: "danger" })
  })
})
