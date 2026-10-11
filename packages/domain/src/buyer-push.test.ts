import { describe, expect, test } from "bun:test"
import { buyerStatusPush, orderConfirmedPush } from "./buyer-push"
import type { FulfilmentState } from "./fulfilment"

const order = { display_id: 42, shop: "Mama Put Groceries", rejected_by: null }

describe("buyerStatusPush", () => {
  test.each([
    ["accepted", "Order #42 accepted", "Mama Put Groceries is preparing your order."],
    ["label_booked", "Courier booked for order #42", "Mama Put Groceries has booked a courier to deliver your order."],
    ["handed_to_courier", "Order #42 picked up", "The courier has collected your order from Mama Put Groceries."],
    ["delivered", "Order #42 delivered", "Your order from Mama Put Groceries has arrived."],
  ] as const)("tells the buyer their order is %s", (state, title, body) => {
    expect(buyerStatusPush(state, order)).toEqual({ title, body })
  })

  test("tells the buyer the shop rejected their order and that it is refunded", () => {
    expect(buyerStatusPush("rejected", { ...order, rejected_by: "seller" })).toEqual({
      title: "Order #42 cancelled",
      body: "Mama Put Groceries couldn't take your order. You'll get a full refund.",
    })
  })

  test("tells the buyer an order the shop didn't accept in time is refunded", () => {
    expect(buyerStatusPush("rejected", { ...order, rejected_by: "accept_deadline" })).toEqual({
      title: "Order #42 cancelled",
      body: "Mama Put Groceries didn't accept your order in time. You'll get a full refund.",
    })
  })

  test.each<FulfilmentState>(["new", "picking", "partially_available", "packed", "courier_confirmed", "in_transit"])(
    "stays quiet about the shop's own steps (%s)",
    (state) => {
      expect(buyerStatusPush(state, order)).toBeNull()
    }
  )
})

describe("orderConfirmedPush", () => {
  test("confirms a one-shop order and says the shop is next", () => {
    expect(orderConfirmedPush({ display_id: 7, shops: [{ name: "Gadget Hub", opens: null }] })).toEqual({
      title: "Order #7 confirmed",
      body: "We'll let you know when Gadget Hub accepts it.",
    })
  })

  test("confirms an order across shops", () => {
    const shops = [
      { name: "Gadget Hub", opens: null },
      { name: "Mama Put Groceries", opens: null },
    ]
    expect(orderConfirmedPush({ display_id: 7, shops })).toEqual({
      title: "Order #7 confirmed",
      body: "We'll let you know as each of your 2 shops accepts it.",
    })
  })

  test("says a shop that is closed now prepares its order when it opens", () => {
    const shops = [
      { name: "Gadget Hub", opens: null },
      { name: "Mama Put Groceries", opens: "8am Tue" },
    ]
    expect(orderConfirmedPush({ display_id: 7, shops })).toEqual({
      title: "Order #7 confirmed",
      body: "Mama Put Groceries is closed now: it prepares your order when it opens at 8am Tue.",
    })
  })
})
