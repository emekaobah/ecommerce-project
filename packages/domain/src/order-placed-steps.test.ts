import { describe, expect, test } from "bun:test"
import { orderPlacedSteps, type PlacedOrder } from "./order-placed-steps"

const LAGOS = "Africa/Lagos"
// Friday 23 October 2026, 9:41 in Lagos.
const now = new Date("2026-10-23T08:41:00Z")

const order = (overrides: Partial<PlacedOrder> = {}): PlacedOrder => ({
  id: "ord_1",
  seller: { name: "Iya Bisi Foodstuff" },
  shop_opens: null,
  delivery: null,
  pickup: null,
  ...overrides,
})

describe("orderPlacedSteps", () => {
  test("an open shop delivering: it accepts today, then its order arrives on the quoted day", () => {
    const delivery = { courier_name: "GIG", delivery_eta_time: "2026-10-26T12:00:00Z", time_zone: LAGOS, switched_from: null }
    expect(orderPlacedSteps([order({ delivery })], now)).toEqual([
      { key: "ord_1-accepts", title: "Iya Bisi Foodstuff accepts", detail: "Waiting for the shop", day: "Today", now: true },
      {
        key: "ord_1-arrives",
        title: "Iya Bisi Foodstuff's order arrives",
        detail: "Arrives Mon 26 Oct, by the courier you chose",
        day: "Mon",
        now: false,
      },
    ])
  })

  test("a closed shop prepares the order when it opens", () => {
    const steps = orderPlacedSteps([order({ seller: { name: "Adire House" }, shop_opens: { at: "2026-10-26T09:00:00Z", time_zone: LAGOS } })], now)
    expect(steps[1]).toEqual({
      key: "ord_1-opens",
      title: "Adire House prepares your order",
      detail: "When it opens, 10am Mon",
      day: "Mon",
      now: false,
    })
  })

  test("a pickup order is collected once ready, with no day yet", () => {
    expect(orderPlacedSteps([order({ pickup: {} })], now)[1]).toEqual({
      key: "ord_1-collect",
      title: "Collect from Iya Bisi Foodstuff",
      detail: "Once it's ready, your pickup code is in Orders",
      day: null,
      now: false,
    })
  })

  test("each shop's steps follow on, shop by shop", () => {
    const keys = orderPlacedSteps([order({ pickup: {} }), order({ id: "ord_2" })], now).map((step) => step.key)
    expect(keys).toEqual(["ord_1-accepts", "ord_1-collect", "ord_2-accepts"])
  })

  test("the days are the region's, not UTC's", () => {
    // 23:30 UTC on Sunday is Monday in Lagos.
    const delivery = { courier_name: "GIG", delivery_eta_time: "2026-10-25T23:30:00Z", time_zone: LAGOS, switched_from: null }
    expect(orderPlacedSteps([order({ delivery })], now)[1]!.day).toBe("Mon")
  })
})
