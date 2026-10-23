import { describe, expect, test } from "bun:test"
import { formatMoney } from "./money"
import { orderAgainClosedNote, orderAgainLines, orderAgainSummary, type OrderAgainItemInput } from "./order-again"

const naira = (amount: number) => formatMoney(amount, "ngn")

const item = (overrides: Partial<OrderAgainItemInput> = {}): OrderAgainItemInput => ({
  id: "item_tomatoes",
  product_title: "Fresh Tomatoes",
  variant_title: "1kg",
  thumbnail: null,
  quantity: 2,
  paid_unit_price: 3500,
  price_changed: false,
  unavailable: null,
  offer: { id: "offer_tomatoes", unit_price: 3500, compare_at_unit_price: null, available_quantity: null },
  ...overrides,
})

describe("orderAgainLines", () => {
  test("a line at the price paid adds what was ordered, with no note", () => {
    expect(orderAgainLines([item()], "ngn")).toEqual([
      {
        id: "item_tomatoes",
        offerId: "offer_tomatoes",
        addable: true,
        quantity: 2,
        capped: false,
        unitPrice: 3500,
        total: 7000,
        note: null,
      },
    ])
  })

  test("a changed price is called out, up or down, and the total is at today's price", () => {
    const up = item({ price_changed: true, offer: { id: "offer_tomatoes", unit_price: 3800, compare_at_unit_price: null, available_quantity: null } })
    const down = item({ price_changed: true, offer: { id: "offer_tomatoes", unit_price: 3000, compare_at_unit_price: null, available_quantity: null } })
    const [higher, lower] = orderAgainLines([up, down], "ngn")
    expect(higher).toMatchObject({ note: `Now ${naira(3800)} each, was ${naira(3500)}`, total: 7600, addable: true })
    expect(lower).toMatchObject({ note: `Now ${naira(3000)} each, was ${naira(3500)}`, total: 6000 })
  })

  const stocked = (available_quantity: number | null) => ({ id: "offer_tomatoes", unit_price: 3500, compare_at_unit_price: null, available_quantity })

  test("a shop that doesn't track stock gets what was ordered", () => {
    expect(orderAgainLines([item({ quantity: 5, offer: stocked(null) })], "ngn")[0]).toMatchObject({ quantity: 5, capped: false, addable: true })
  })

  test("never more than is left: fewer left than ordered caps the line and says so", () => {
    expect(orderAgainLines([item({ quantity: 3, offer: stocked(1) })], "ngn")[0]).toEqual({
      id: "item_tomatoes",
      offerId: "offer_tomatoes",
      addable: true,
      quantity: 1,
      capped: true,
      unitPrice: 3500,
      total: 3500,
      note: "Only 1 left",
    })
  })

  test("enough left adds what was ordered", () => {
    expect(orderAgainLines([item({ quantity: 2, offer: stocked(2) })], "ngn")[0]).toMatchObject({ quantity: 2, capped: false, note: null })
  })

  test("a capped line with a new price says both", () => {
    const line = item({ quantity: 3, price_changed: true, offer: { ...stocked(2), unit_price: 3800 } })
    expect(orderAgainLines([line], "ngn")[0]).toMatchObject({ quantity: 2, total: 7600, note: `Now ${naira(3800)} each, was ${naira(3500)} · Only 2 left` })
  })

  test("sold out can't be added", () => {
    const soldOut = { id: "item_tomatoes", offerId: "offer_tomatoes", addable: false, quantity: 0, capped: false, unitPrice: null, total: null, note: "Not available now" }
    expect(orderAgainLines([item({ unavailable: "sold_out", offer: stocked(0) })], "ngn")[0]).toEqual(soldOut)
    // Whichever the API says first: no stock left is sold out.
    expect(orderAgainLines([item({ offer: stocked(0) })], "ngn")[0]).toEqual(soldOut)
  })

  test("an item the shop no longer sells can't be added", () => {
    expect(orderAgainLines([item({ unavailable: "not_sold", price_changed: false, offer: null })], "ngn")[0]).toEqual({
      id: "item_tomatoes",
      offerId: null,
      addable: false,
      quantity: 0,
      capped: false,
      unitPrice: null,
      total: null,
      note: "Not available now",
    })
  })
})

describe("orderAgainSummary", () => {
  const lines = orderAgainLines(
    [
      item({ id: "tomatoes", quantity: 2, price_changed: true, offer: { id: "o1", unit_price: 3800, compare_at_unit_price: null, available_quantity: null } }),
      item({ id: "beans", quantity: 1, paid_unit_price: 6800, offer: { id: "o2", unit_price: 6800, compare_at_unit_price: null, available_quantity: null } }),
      item({ id: "palm_oil", quantity: 1, unavailable: "not_sold", offer: null }),
    ],
    "ngn"
  )

  test("counts the items and totals the ticked lines only", () => {
    expect(orderAgainSummary(lines, new Set(["tomatoes", "beans"]))).toEqual({ count: 3, total: 14400, label: "Add 3 items to cart" })
    expect(orderAgainSummary(lines, new Set(["beans"]))).toEqual({ count: 1, total: 6800, label: "Add 1 item to cart" })
  })

  test("a line that can't be added never counts, even ticked", () => {
    expect(orderAgainSummary(lines, new Set(["beans", "palm_oil"]))).toMatchObject({ count: 1, total: 6800 })
  })

  test("nothing ticked", () => {
    expect(orderAgainSummary(lines, new Set())).toEqual({ count: 0, total: 0, label: "Add to cart" })
  })
})

describe("orderAgainClosedNote", () => {
  const seller = { name: "Iya Bisi Foodstuff" }

  test("an open shop needs no note", () => {
    expect(orderAgainClosedNote({ not_taking_orders: null, shop_status: { state: "open", label: "Open · closes 7pm" }, seller })).toBeNull()
  })

  test("outside its hours the shop still takes orders, prepared when it opens", () => {
    expect(orderAgainClosedNote({ not_taking_orders: null, shop_status: { state: "closed", label: "Closed · opens 10am Mon" }, seller })).toBe(
      "Prepared when it opens 10am Mon"
    )
    expect(orderAgainClosedNote({ not_taking_orders: null, shop_status: { state: "closed", label: "Closed" }, seller })).toBe("Prepared when it opens")
  })

  test("paused or closed for a date: until when, with the shop's note", () => {
    const status = { state: "closed_until" as const, label: "Closed until Tue 14 Oct", note: "Back after the holiday." }
    expect(orderAgainClosedNote({ not_taking_orders: "closed", shop_status: status, seller })).toBe("Closed until Tue 14 Oct. Back after the holiday.")
    expect(orderAgainClosedNote({ not_taking_orders: "paused", shop_status: { ...status, note: null }, seller })).toBe("Closed until Tue 14 Oct")
  })

  test("a shop that has left Oja", () => {
    expect(orderAgainClosedNote({ not_taking_orders: "left", shop_status: null, seller })).toBe("Iya Bisi Foodstuff isn't selling on Oja now.")
  })

  test("not taking orders without a status still says so", () => {
    expect(orderAgainClosedNote({ not_taking_orders: "paused", shop_status: null, seller })).toBe("Iya Bisi Foodstuff isn't taking orders now.")
  })
})
