import { describe, expect, test } from "bun:test"
import { formatMoney } from "./money"
import { historyEntries, orderStatus, owedRefundStatus, refundStatus } from "./order-history"

const placed = { state: "new", rejected_by: null, reject_reason: null, cancellation: null } as const

describe("orderStatus", () => {
  test("a new order waits for its shop to accept it", () => {
    expect(orderStatus({ fulfilment: placed })).toEqual({ label: "Waiting for the shop", tone: "warning", note: null })
  })

  test.each([
    ["accepted", "Accepted", "info"],
    ["picking", "Being prepared", "info"],
    ["partially_available", "Being prepared", "info"],
    ["packed", "Packed", "info"],
    ["label_booked", "Courier booked", "info"],
    ["courier_confirmed", "Courier booked", "info"],
    ["handed_to_courier", "On its way", "info"],
    ["in_transit", "On its way", "info"],
    ["delivered", "Delivered", "success"],
    ["ready_for_pickup", "Ready for pickup", "success"],
    ["collected", "Collected", "success"],
    ["not_collected", "Not collected", "danger"],
  ] as const)("a %s order reads %s", (state, label, tone) => {
    expect(orderStatus({ fulfilment: { ...placed, state } })).toEqual({ label, tone, note: null })
  })

  test("an order its shop cancelled after accepting it says why (#17)", () => {
    const cancellation = { by: "seller", reason: "items_unavailable", note: null } as const
    expect(orderStatus({ fulfilment: { ...placed, state: "cancelled", cancellation } })).toEqual({
      label: "Cancelled by the shop",
      tone: "danger",
      note: "Items unavailable",
    })
  })

  test("an order Oja's team cancelled says why, in the note they wrote", () => {
    const cancellation = { by: "operator", reason: "other", note: "The shop has closed" } as const
    expect(orderStatus({ fulfilment: { ...placed, state: "cancelled", cancellation } })).toEqual({
      label: "Cancelled by Oja's team",
      tone: "danger",
      note: "The shop has closed",
    })
  })

  test("a rejected order gives the shop's reason", () => {
    const fulfilment = { state: "rejected", rejected_by: "seller", reject_reason: "Out of stock", cancellation: null } as const
    expect(orderStatus({ fulfilment })).toEqual({ label: "Rejected by the shop", tone: "danger", note: "Out of stock" })
  })

  test("an order the shop didn't accept in time says so, whatever reason was recorded", () => {
    const fulfilment = { state: "rejected", rejected_by: "accept_deadline", reject_reason: "Not accepted in time", cancellation: null } as const
    expect(orderStatus({ fulfilment })).toEqual({ label: "Not accepted in time", tone: "danger", note: null })
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
    ["pending", "Refund on its way", "info"],
    ["processing", "Refund on its way", "info"],
    ["processed", "Refunded", "success"],
    ["failed", "Refund delayed", "warning"],
  ] as const)("a %s refund reads %s", (status, label, tone) => {
    expect(refundStatus({ amount: 12300, status })).toMatchObject({ label, tone })
  })

  test("a refund that failed is tried again for the buyer", () => {
    expect(refundStatus({ amount: 12300, status: "failed" })?.note).toBe("It didn't go through, so we're trying again.")
  })

  test("a refund Paystack couldn't return to the card waits for the buyer's bank account (#13)", () => {
    expect(refundStatus({ amount: 12300, status: "needs-attention" })).toEqual({
      label: "Refund delayed",
      tone: "warning",
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
      tone: "warning",
      note: `Refund of ${formatMoney(12300, "ngn")} pending`,
    })
  })

  test("a refund Oja's team sends by hand says so", () => {
    expect(owedRefundStatus({ amount: 30, state: "manual" }, "ngn")).toEqual({
      label: "Refund pending",
      tone: "warning",
      note: `Our team is sending your ${formatMoney(30, "ngn")} refund`,
    })
  })
})
