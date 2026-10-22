import { describe, expect, test } from "bun:test"
import { formatMoney } from "./money"
import { historyEntries, missingItemsNote, orderGroupSummary, orderStatus, owedRefundStatus, refundStatus } from "./order-history"

const placed = { state: "new", rejected_by: null, reject_reason: null, cancellation: null } as const

describe("orderStatus", () => {
  test("a new order waits for its shop to accept it", () => {
    expect(orderStatus({ fulfilment: placed })).toEqual({ label: "Waiting for the shop", tone: "new", icon: "clock", note: null })
  })

  test.each([
    ["accepted", "Accepted", "info", "box"],
    ["picking", "Being prepared", "info", "box"],
    ["partially_available", "Being prepared", "info", "box"],
    ["packed", "Packed", "info", "box"],
    ["label_booked", "Courier booked", "info", "truck"],
    ["courier_confirmed", "Courier booked", "info", "truck"],
    ["handed_to_courier", "On its way", "info", "truck"],
    ["in_transit", "On its way", "info", "truck"],
    ["delivered", "Delivered", "success", "check"],
    ["ready_for_pickup", "Ready for pickup", "success", "store"],
    ["collected", "Collected", "success", "check"],
    ["not_collected", "Not collected", "neutral", "x"],
  ] as const)("a %s order reads %s", (state, label, tone, icon) => {
    expect(orderStatus({ fulfilment: { ...placed, state } })).toEqual({ label, tone, icon, note: null })
  })

  test("an order its shop cancelled after accepting it says why (#17)", () => {
    const cancellation = { by: "seller", reason: "items_unavailable", note: null } as const
    expect(orderStatus({ fulfilment: { ...placed, state: "cancelled", cancellation } })).toEqual({
      label: "Cancelled by the shop",
      tone: "neutral",
      icon: "x",
      note: "Items unavailable",
    })
  })

  test("an order Oja's team cancelled says why, in the note they wrote", () => {
    const cancellation = { by: "operator", reason: "other", note: "The shop has closed" } as const
    expect(orderStatus({ fulfilment: { ...placed, state: "cancelled", cancellation } })).toEqual({
      label: "Cancelled by Oja's team",
      tone: "neutral",
      icon: "x",
      note: "The shop has closed",
    })
  })

  test("a rejected order gives the shop's reason", () => {
    const fulfilment = { state: "rejected", rejected_by: "seller", reject_reason: "Out of stock", cancellation: null } as const
    expect(orderStatus({ fulfilment })).toEqual({ label: "Rejected by the shop", tone: "neutral", icon: "x", note: "Out of stock" })
  })

  test("an order the shop didn't accept in time says so, whatever reason was recorded", () => {
    const fulfilment = { state: "rejected", rejected_by: "accept_deadline", reject_reason: "Not accepted in time", cancellation: null } as const
    expect(orderStatus({ fulfilment })).toEqual({ label: "Not accepted in time", tone: "neutral", icon: "x", note: null })
  })
})

describe("historyEntries", () => {
  const order = (id: string, paid_total: number) => ({ id, paid_total })
  const combined = { id: "og_combined", created_at: "2026-10-03T10:00:00.000Z", orders: [order("ord_gadgets", 12300), order("ord_grocery", 9000)] }
  // Paying shop by shop (#65) makes a group per shop, each with one order.
  const onItsOwn = { id: "og_alone", created_at: "2026-10-03T10:05:00.000Z", orders: [order("ord_fashion", 25000)] }

  test("shows a checkout split across shops as one entry, with what was paid in all", () => {
    expect(historyEntries([combined])).toEqual([{ kind: "group", group: combined, paid_total: 21300 }])
  })

  test("shows a group of one order as that order, without the group around it", () => {
    expect(historyEntries([onItsOwn])).toEqual([{ kind: "order", group: onItsOwn, order: onItsOwn.orders[0]!, paid_total: 25000 }])
  })

  test("keeps the groups in the order they're listed, newest first", () => {
    expect(historyEntries([onItsOwn, combined]).map((e) => e.group.id)).toEqual(["og_alone", "og_combined"])
  })

  test("leaves out a group with no orders", () => {
    expect(historyEntries([{ ...combined, orders: [] }])).toEqual([])
  })
})

describe("refundStatus", () => {
  test("is nothing when nothing has been refunded", () => {
    expect(refundStatus(null)).toBeNull()
  })

  test.each([
    ["pending", "Refund on its way", "success", "check"],
    ["processing", "Refund on its way", "success", "check"],
    ["processed", "Refunded", "success", "check"],
    ["failed", "Refund delayed", "new", "clock"],
  ] as const)("a %s refund reads %s", (status, label, tone, icon) => {
    expect(refundStatus({ amount: 12300, status })).toMatchObject({ label, tone, icon })
  })

  test("a refund that failed is tried again for the buyer", () => {
    expect(refundStatus({ amount: 12300, status: "failed" })?.note).toBe("It didn't go through, so we're trying again.")
  })

  test("a refund Paystack couldn't return to the card waits for the buyer's bank account (#13), in ember", () => {
    expect(refundStatus({ amount: 12300, status: "needs-attention" })).toEqual({
      label: "Refund delayed · add your bank",
      tone: "attention",
      icon: "info",
      note: "Your bank couldn't take it back to your card. Add a bank account to receive it.",
    })
  })
})

describe("owedRefundStatus", () => {
  test("is nothing while the order owes nothing", () => {
    expect(owedRefundStatus(null, "ngn")).toBeNull()
  })

  test("a refund still being retried is pending", () => {
    expect(owedRefundStatus({ amount: 12300, state: "retrying" }, "ngn")).toEqual({
      label: "Refund pending",
      tone: "new",
      icon: "clock",
      note: `Refund of ${formatMoney(12300, "ngn")} pending`,
    })
  })

  test("a refund Oja's team sends by hand says so", () => {
    expect(owedRefundStatus({ amount: 30, state: "manual" }, "ngn")).toEqual({
      label: "Refund pending",
      tone: "new",
      icon: "clock",
      note: `Our team is sending your ${formatMoney(30, "ngn")} refund`,
    })
  })
})

describe("orderGroupSummary", () => {
  const shopOrder = (state: (typeof placed)["state"] | "packed" | "in_transit" | "delivered", opens = false) => ({
    fulfilment: { ...placed, state },
    shop_opens: opens ? { at: "2026-10-26T09:00:00Z", time_zone: "Africa/Lagos" } : null,
  })

  test("a checkout split across shops says where each shop's part is", () => {
    expect(orderGroupSummary([shopOrder("packed"), shopOrder("new", true)])).toBe("One packed, one waiting for the shop to open")
  })

  test("one shop's order reads as its state", () => {
    expect(orderGroupSummary([shopOrder("in_transit")])).toBe("On its way")
  })

  test("shops at the same point are counted together", () => {
    expect(orderGroupSummary([shopOrder("packed"), shopOrder("delivered"), shopOrder("packed")])).toBe(
      "Two packed, one delivered"
    )
  })

  test("every shop at the same point says so", () => {
    expect(orderGroupSummary([shopOrder("delivered"), shopOrder("delivered")])).toBe("Both delivered")
    expect(orderGroupSummary([shopOrder("packed"), shopOrder("packed"), shopOrder("packed")])).toBe("All three packed")
  })
})

describe("missingItemsNote", () => {
  const tomatoes = { id: "item_1", product_title: "Fresh Tomatoes 1kg", quantity: 0, unavailable_quantity: 2 }
  const beans = { id: "item_2", product_title: "Honey Beans 2kg", quantity: 1, unavailable_quantity: 0 }
  const refundFor = (status: "pending" | "processing" | "processed" | "failed" | "needs-attention", amount = 3500) => ({
    amount,
    status,
    lines: [{ item_id: "item_1", quantity: 2 }],
  })

  test("an item the shop didn't have is explained with where its refund is", () => {
    expect(missingItemsNote({ items: [tomatoes, beans], refunds: [refundFor("processing")], currency_code: "ngn" })).toEqual({
      missing: "Fresh Tomatoes 1kg wasn't available.",
      refund: `${formatMoney(3500, "ngn")} is on its way back to your card.`,
    })
  })

  test("once the refund is made it says so, without promising when the bank shows it", () => {
    expect(missingItemsNote({ items: [tomatoes], refunds: [refundFor("processed")], currency_code: "ngn" })?.refund).toBe(
      `${formatMoney(3500, "ngn")} has been refunded to your card.`
    )
  })

  test.each(["failed", "needs-attention"] as const)("a %s refund is left to its chip", (status) => {
    expect(missingItemsNote({ items: [tomatoes], refunds: [refundFor(status)], currency_code: "ngn" })).toEqual({
      missing: "Fresh Tomatoes 1kg wasn't available.",
      refund: null,
    })
  })

  test("refunds for other lines, or for no lines, aren't counted", () => {
    const delivery = { amount: 1800, status: "processed" as const, lines: null }
    const other = { amount: 900, status: "processed" as const, lines: [{ item_id: "item_9", quantity: 1 }] }
    expect(missingItemsNote({ items: [tomatoes], refunds: [delivery, other], currency_code: "ngn" })?.refund).toBeNull()
  })

  test("several missing items are named together, and their refunds added up", () => {
    const rice = { id: "item_3", product_title: "Ofada Rice 5kg", quantity: 0, unavailable_quantity: 1 }
    const oil = { id: "item_4", product_title: "Red Palm Oil 3L", quantity: 0, unavailable_quantity: 1 }
    const riceRefund = { amount: 9000, status: "pending" as const, lines: [{ item_id: "item_3", quantity: 1 }] }
    expect(
      missingItemsNote({ items: [tomatoes, rice, oil], refunds: [refundFor("processed"), riceRefund], currency_code: "ngn" })
    ).toEqual({
      missing: "Fresh Tomatoes 1kg, Ofada Rice 5kg and Red Palm Oil 3L weren't available.",
      refund: `${formatMoney(12500, "ngn")} is on its way back to your card.`,
    })
  })

  test("part of a line missing says how many of it", () => {
    const some = { ...tomatoes, quantity: 1, unavailable_quantity: 2 }
    expect(missingItemsNote({ items: [some], refunds: [], currency_code: "ngn" })?.missing).toBe(
      "2 of 3 Fresh Tomatoes 1kg weren't available."
    )
  })

  test("nothing missing, no note", () => {
    expect(missingItemsNote({ items: [beans], refunds: [], currency_code: "ngn" })).toBeNull()
  })
})
