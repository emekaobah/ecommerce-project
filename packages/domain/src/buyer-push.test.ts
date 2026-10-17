import { describe, expect, test } from "bun:test"
import {
  buyerStatusPush,
  holdReminderPush,
  itemsRemovedPush,
  notCollectedPush,
  orderCollectedPush,
  orderCancelledPush,
  orderConfirmedPush,
  refundAccountPush,
  refundByHandPush,
  refundCompletedPush,
} from "./buyer-push"
import { formatMoney } from "./money"
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

  describe("a pickup order", () => {
    const pickup = {
      address: { address_1: "14 Adeniran Ogunsanya Street", address_2: null, city: "Surulere", landmark: "Beside the filling station" },
      weekly: {
        mon: [{ opens: "07:00", closes: "20:00" }],
        tue: [{ opens: "07:00", closes: "20:00" }],
        wed: [{ opens: "07:00", closes: "20:00" }],
        thu: [{ opens: "07:00", closes: "20:00" }],
        fri: [{ opens: "07:00", closes: "20:00" }],
        sat: [{ opens: "07:00", closes: "20:00" }],
        sun: [],
      },
    }

    test("ready tells the buyer the code is in the app, where to collect, and the shop's hours", () => {
      expect(buyerStatusPush("ready_for_pickup", { ...order, pickup })).toEqual({
        title: "Order #42 is ready for pickup",
        body:
          "Your pickup code is in the Oja app. Collect it from Mama Put Groceries, 14 Adeniran Ogunsanya Street, Surulere " +
          "(Beside the filling station). Hours: Mon–Sat 07:00–20:00; Sun Closed.",
      })
    })

    test("ready leaves out the hours of a shop that has none set", () => {
      const { body } = buyerStatusPush("ready_for_pickup", {
        ...order,
        pickup: { address: { ...pickup.address, landmark: null }, weekly: null },
      })!
      expect(body).toBe("Your pickup code is in the Oja app. Collect it from Mama Put Groceries, 14 Adeniran Ogunsanya Street, Surulere.")
    })

    test("leaves collecting to its receipt (`orderCollectedPush`)", () => {
      expect(buyerStatusPush("collected", { ...order, pickup })).toBeNull()
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

describe("itemsRemovedPush", () => {
  const order = { display_id: 42, shop: "Mama Put Groceries", refund: 14500, currency_code: "ngn" }

  test("names the items the shop didn't have and what is refunded", () => {
    expect(itemsRemovedPush({ ...order, items: [{ title: "Ofada Rice 5kg", quantity: 1 }] })).toEqual({
      title: "Items removed from order #42",
      body: `Mama Put Groceries didn't have 1 × Ofada Rice 5kg. You'll be refunded ${formatMoney(14500, "ngn")}.`,
    })
  })

  test("names two lines", () => {
    const items = [
      { title: "Ofada Rice 5kg", quantity: 2 },
      { title: "Honey Beans 2kg", quantity: 1 },
    ]
    expect(itemsRemovedPush({ ...order, items }).body).toBe(
      `Mama Put Groceries didn't have 2 × Ofada Rice 5kg and 1 × Honey Beans 2kg. You'll be refunded ${formatMoney(14500, "ngn")}.`
    )
  })

  test("counts the units instead once more than two lines were removed", () => {
    const items = [
      { title: "Ofada Rice 5kg", quantity: 2 },
      { title: "Honey Beans 2kg", quantity: 1 },
      { title: "Palm Oil 1L", quantity: 1 },
    ]
    expect(itemsRemovedPush({ ...order, items }).body).toBe(
      `Mama Put Groceries didn't have 4 of your items. You'll be refunded ${formatMoney(14500, "ngn")}.`
    )
  })
})

describe("orderCancelledPush", () => {
  const order = { display_id: 42, shop: "Mama Put Groceries", refund: 14500, currency_code: "ngn" }

  test("tells the buyer the shop cancelled their order, why, and what they are refunded", () => {
    const cancellation = { by: "seller", reason: "items_unavailable", note: null } as const
    expect(orderCancelledPush({ ...order, cancellation })).toEqual({
      title: "Order #42 cancelled",
      body: `Mama Put Groceries cancelled your order: Items unavailable. You'll be refunded ${formatMoney(14500, "ngn")}.`,
    })
  })

  test("says it was Oja's team that cancelled it, with their note", () => {
    const cancellation = { by: "operator", reason: "other", note: "The shop has closed" } as const
    expect(orderCancelledPush({ ...order, cancellation }).body).toBe(
      `Oja's team cancelled your order from Mama Put Groceries: The shop has closed. You'll be refunded ${formatMoney(14500, "ngn")}.`
    )
  })

  test("promises no refund when nothing was paid for it", () => {
    const cancellation = { by: "seller", reason: "buyer_asked", note: null } as const
    expect(orderCancelledPush({ ...order, refund: 0, cancellation }).body).toBe(
      "Mama Put Groceries cancelled your order: Buyer asked to cancel."
    )
  })
})

describe("refundCompletedPush", () => {
  test("says the refund from the shop has completed", () => {
    expect(refundCompletedPush({ display_id: 42, shop: "Mama Put Groceries", amount: 14500, currency_code: "ngn" })).toEqual({
      title: "Refund for order #42 completed",
      body: `The refund of ${formatMoney(14500, "ngn")} from Mama Put Groceries has completed.`,
    })
  })
})

describe("refundByHandPush", () => {
  test("tells the buyer Oja's team is sending their refund", () => {
    expect(refundByHandPush({ display_id: 42, shop: "Mama Put Groceries", amount: 30, currency_code: "ngn" })).toEqual({
      title: "Refund for order #42",
      body: `Our team is sending your ${formatMoney(30, "ngn")} refund for your order from Mama Put Groceries.`,
    })
  })
})

describe("refundAccountPush", () => {
  const refund = { display_id: 42, shop: "Mama Put Groceries", amount: 14500, currency_code: "ngn" }

  test("asks the buyer for a bank account to receive the refund their card couldn't take", () => {
    expect(refundAccountPush(refund)).toEqual({
      title: "Your refund needs your bank account",
      body: `Your bank couldn't take the ${formatMoney(14500, "ngn")} refund for order #42 from Mama Put Groceries back to your card. Add a bank account to receive it.`,
    })
  })

  test("reminds them, saying when Oja's team takes it over", () => {
    expect(refundAccountPush(refund, { days_left: 6 })).toEqual({
      title: "Reminder: your refund needs your bank account",
      body: `Add a bank account to receive your ${formatMoney(14500, "ngn")} refund for order #42. If you don't within 6 days, our team will contact you.`,
    })
    expect(refundAccountPush(refund, { days_left: 1 }).body).toContain("within 1 day,")
  })
})

describe("pickup pushes (#33)", () => {
  const order = { display_id: 42, shop: "Mama Put Groceries" }

  test("reminds the buyer half-way through the hold when to collect by, and that the code is in the app", () => {
    expect(holdReminderPush({ ...order, reminder: "half_way", collect_by: "Collect by 6pm, Thu 15 Oct", perishable: false })).toEqual({
      title: "Order #42 is waiting for you",
      body: "Collect by 6pm, Thu 15 Oct from Mama Put Groceries. Your pickup code is in the Oja app.",
    })
  })

  test("reminds the buyer on the last day what happens if they don't collect", () => {
    expect(holdReminderPush({ ...order, reminder: "last_day", collect_by: "Collect by 6pm today", perishable: false })).toEqual({
      title: "Last day to collect order #42",
      body: "Collect by 6pm today from Mama Put Groceries, or it is refunded instead. Your pickup code is in the Oja app.",
    })
    expect(holdReminderPush({ ...order, reminder: "last_day", collect_by: "Collect by 6pm today", perishable: true }).body).toBe(
      "Collect by 6pm today from Mama Put Groceries, or it is refunded instead, except its fresh items. Your pickup code is in the Oja app."
    )
  })

  test("tells the buyer their receipt for a collected order is in their email", () => {
    expect(orderCollectedPush(order)).toEqual({
      title: "Order #42 collected",
      body: "You collected your order from Mama Put Groceries. Your receipt is in your email.",
    })
  })

  describe("notCollectedPush", () => {
    const notice = { ...order, refund: 14500, currency_code: "ngn" }

    test("tells the buyer an order not collected in time is refunded", () => {
      expect(notCollectedPush({ ...notice, kept: [] })).toEqual({
        title: "Order #42 wasn't collected",
        body: `Mama Put Groceries held it, but it wasn't collected in time. You'll be refunded ${formatMoney(14500, "ngn")}.`,
      })
    })

    test("names the fresh items that aren't refunded", () => {
      expect(notCollectedPush({ ...notice, kept: [{ title: "Tomatoes 1kg", quantity: 1 }] }).body).toBe(
        `Mama Put Groceries held it, but it wasn't collected in time. You'll be refunded ${formatMoney(14500, "ngn")}. ` +
          "Fresh items aren't refunded: 1 × Tomatoes 1kg."
      )
    })

    test("promises no refund when every item was fresh", () => {
      expect(notCollectedPush({ ...notice, refund: 0, kept: [{ title: "Tomatoes 1kg", quantity: 2 }] }).body).toBe(
        "Mama Put Groceries held it, but it wasn't collected in time. Fresh items aren't refunded: 2 × Tomatoes 1kg."
      )
    })

    test("counts the fresh units once more than two lines are kept", () => {
      const kept = [
        { title: "Tomatoes 1kg", quantity: 1 },
        { title: "Fresh Fish", quantity: 1 },
        { title: "Ugu Leaves", quantity: 2 },
      ]
      expect(notCollectedPush({ ...notice, refund: 0, kept }).body).toBe(
        "Mama Put Groceries held it, but it wasn't collected in time. Fresh items aren't refunded: 4 of your items."
      )
    })
  })
})
