import { describe, expect, test } from "bun:test"
import { orderBuyerLine, type BuyerLineOrder } from "./order-buyer-line"

const LAGOS = "Africa/Lagos"

const order = (overrides: Partial<BuyerLineOrder> = {}): BuyerLineOrder => ({
  billing_address: { first_name: "Tolu", last_name: "Adeyemi" },
  shipping_address: { city: "Surulere" },
  shipping_methods: [{ data: { quote: { courier_name: "GIG", delivery_eta_time: "2026-10-22T15:00:00Z" } } }],
  fulfilment: { method: "delivery", shipment: null },
  ...overrides,
})

describe("orderBuyerLine", () => {
  test("names the buyer, their area, and the courier they chose with its arrival day", () => {
    expect(orderBuyerLine(order(), LAGOS)).toBe("For Tolu A. · Surulere · buyer chose GIG, arriving Thu")
  })

  test("a pickup order is collected in store", () => {
    expect(orderBuyerLine(order({ fulfilment: { method: "pickup", shipment: null } }), LAGOS)).toBe("For Tolu A. · collecting in store")
  })

  test("once a label is booked the courier block takes over, so the buyer's choice goes", () => {
    expect(orderBuyerLine(order({ fulfilment: { method: "delivery", shipment: { id: "ship_1" } } }), LAGOS)).toBe("For Tolu A. · Surulere")
  })

  test("a buyer without a last name reads by their first name", () => {
    expect(orderBuyerLine(order({ billing_address: { first_name: " Tolu ", last_name: null } }), LAGOS)).toStartWith("For Tolu · ")
  })

  test("leaves out what the order doesn't say", () => {
    expect(orderBuyerLine(order({ billing_address: null, shipping_address: { city: "  " }, shipping_methods: null }), LAGOS)).toBe("")
  })

  test("skips a shipping method without a full quote", () => {
    const methods = [null, { data: { quote: { courier_name: "Kwik" } } }, { data: { quote: { courier_name: "GIG", delivery_eta_time: "2026-10-26T09:00:00Z" } } }]
    expect(orderBuyerLine(order({ shipping_methods: methods }), LAGOS)).toBe("For Tolu A. · Surulere · buyer chose GIG, arriving Mon")
  })

  test("the arrival day is the shop's, not UTC's", () => {
    // 23:30 UTC on Wednesday is already Thursday in Lagos.
    const late = [{ data: { quote: { courier_name: "GIG", delivery_eta_time: "2026-10-21T23:30:00Z" } } }]
    expect(orderBuyerLine(order({ shipping_methods: late }), LAGOS)).toEndWith("arriving Thu")
  })
})
