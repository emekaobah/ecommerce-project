import { describe, expect, test } from "bun:test"
import { formatMoney } from "./money"
import {
  historyEntries,
  missingItemsNote,
  orderCardStatus,
  orderGroupSettled,
  orderGroupSummary,
  orderLineName,
  orderProgress,
  orderStatus,
  owedRefundStatus,
  reachedOnLabel,
  refundForNote,
  refundStatus,
  type ProgressStep,
} from "./order-history"

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

describe("refundForNote", () => {
  const tomatoes = { id: "item_1", product_title: "Fresh Tomatoes 1kg", variant_title: null, quantity: 0, unavailable_quantity: 3 }
  const beans = { id: "item_2", product_title: "Honey Beans 2kg", variant_title: null, quantity: 1, unavailable_quantity: 0 }
  const kaftan = { id: "item_3", product_title: "Adire Kaftan", variant_title: "M", quantity: 1, unavailable_quantity: 0 }
  const order = { group_display_id: 2301, shop: "Iya Bisi Foodstuff", items: [tomatoes, beans, kaftan] }

  test("a refund names the items it was for, in the checkout's number", () => {
    expect(refundForNote({ ...order, lines: [{ item_id: "item_1", quantity: 3 }] })).toBe("For Fresh Tomatoes 1kg in OJ-2301.")
  })

  test("several items are named together, each by its variant too", () => {
    const lines = [
      { item_id: "item_1", quantity: 3 },
      { item_id: "item_2", quantity: 1 },
      { item_id: "item_3", quantity: 1 },
    ]
    expect(refundForNote({ ...order, lines })).toBe("For Fresh Tomatoes 1kg, Honey Beans 2kg and Adire Kaftan · M in OJ-2301.")
  })

  test("part of a line says how many of it", () => {
    expect(refundForNote({ ...order, lines: [{ item_id: "item_1", quantity: 2 }] })).toBe("For 2 of 3 Fresh Tomatoes 1kg in OJ-2301.")
  })

  test("without the checkout's number, the shop says which order", () => {
    expect(refundForNote({ ...order, group_display_id: null, lines: [{ item_id: "item_2", quantity: 1 }] })).toBe(
      "For Honey Beans 2kg from Iya Bisi Foodstuff."
    )
  })

  test("a refund of no lines, or of lines not known here, is for the order", () => {
    expect(refundForNote({ ...order, lines: null })).toBe("For your order OJ-2301 from Iya Bisi Foodstuff.")
    expect(refundForNote({ ...order, items: null, lines: [{ item_id: "item_1", quantity: 3 }] })).toBe(
      "For your order OJ-2301 from Iya Bisi Foodstuff."
    )
    expect(refundForNote({ ...order, group_display_id: null, lines: [{ item_id: "item_9", quantity: 1 }] })).toBe(
      "For your order from Iya Bisi Foodstuff."
    )
  })
})

describe("orderCardStatus", () => {
  test("a new order's chip on its shop card reads just Waiting, beside the shop's name", () => {
    expect(orderCardStatus({ fulfilment: placed })).toEqual({ label: "Waiting", tone: "new", icon: "clock", note: null })
  })

  test("other states read as orderStatus gives them", () => {
    const packed = { fulfilment: { ...placed, state: "packed" as const } }
    expect(orderCardStatus(packed)).toEqual(orderStatus(packed))
  })
})

describe("reachedOnLabel", () => {
  const LAGOS = "Africa/Lagos"
  const timeline = [
    { label: "Placed", status: "done" as const, at: "2026-09-30T09:00:00Z" },
    { label: "Delivered", status: "current" as const, at: "2026-10-02T14:00:00Z" },
  ]

  test("a delivered order reads when it got there", () => {
    expect(reachedOnLabel({ state: "delivered", timeline }, LAGOS)).toBe("Delivered Fri 2 Oct")
  })

  test("a collected order reads when it was collected", () => {
    expect(reachedOnLabel({ state: "collected", timeline }, LAGOS)).toBe("Collected Fri 2 Oct")
  })

  test("the day is the time zone's, not UTC's", () => {
    const late = [{ label: "Delivered", status: "current" as const, at: "2026-10-01T23:30:00Z" }]
    expect(reachedOnLabel({ state: "delivered", timeline: late }, LAGOS)).toBe("Delivered Fri 2 Oct")
  })

  test("a delivered order with no time for its delivery doesn't borrow an earlier step's", () => {
    const unknown = [timeline[0]!, { label: "Delivered", status: "done" as const, at: null }]
    expect(reachedOnLabel({ state: "delivered", timeline: unknown }, LAGOS)).toBeNull()
  })

  test("skips steps still to come", () => {
    const steps = [...timeline, { label: "Reviewed", status: "upcoming" as const, at: "2026-10-09T10:00:00Z" }]
    expect(reachedOnLabel({ state: "delivered", timeline: steps }, LAGOS)).toBe("Delivered Fri 2 Oct")
  })

  test("nothing until it has got there, or without a time", () => {
    expect(reachedOnLabel({ state: "in_transit", timeline }, LAGOS)).toBeNull()
    expect(reachedOnLabel({ state: "delivered", timeline: [] }, LAGOS)).toBeNull()
  })
})

describe("orderLineName", () => {
  test("a line names its product and the variant bought", () => {
    expect(orderLineName({ product_title: "Adire Kaftan", variant_title: "M" })).toBe("Adire Kaftan · M")
  })

  test("a product's only variant, named like the product, isn't repeated", () => {
    expect(orderLineName({ product_title: "Ankara Tote Bag", variant_title: "Ankara Tote Bag" })).toBe("Ankara Tote Bag")
  })

  test("a line with no names still reads as an item", () => {
    expect(orderLineName({ product_title: null, variant_title: null })).toBe("Item")
  })
})

describe("orderProgress", () => {
  // Written out: done before the current step, upcoming after it.
  const steps = (labels: string[], current: number): ProgressStep[] =>
    labels.map((label, i) => {
      if (i === current) return { label, status: "current" }
      return { label, status: i < current ? "done" : "upcoming" }
    })
  const DELIVERY = ["Accepted", "Being prepared", "Packed", "On its way"]
  const PICKUP = ["Accepted", "Being prepared", "Ready for pickup", "Collected"]

  test("a packed delivery is at the third of four steps", () => {
    expect(orderProgress("packed", "delivery")).toEqual(steps(DELIVERY, 2))
  })

  test.each([
    ["accepted", 0],
    ["picking", 1],
    ["partially_available", 1],
    ["label_booked", 2],
    ["courier_confirmed", 2],
    ["handed_to_courier", 3],
    ["in_transit", 3],
  ] as const)("a delivery %s is at step %i", (state, current) => {
    expect(orderProgress(state, "delivery")).toEqual(steps(DELIVERY, current))
  })

  test("a pickup order ready to collect is at its third step, collecting it the last", () => {
    expect(orderProgress("ready_for_pickup", "pickup")).toEqual(steps(PICKUP, 2))
  })

  test.each(["new", "delivered", "collected", "not_collected", "rejected", "cancelled"] as const)(
    "a %s order shows no progress",
    (state) => {
      expect(orderProgress(state, "delivery")).toBeNull()
    }
  )
})

describe("orderGroupSettled", () => {
  const order = (state: "delivered" | "collected" | "rejected" | "cancelled" | "not_collected" | "packed" | "new") => ({ fulfilment: { state } })

  test("a checkout whose shops are all done is settled", () => {
    expect(orderGroupSettled([order("delivered"), order("collected"), order("rejected"), order("cancelled"), order("not_collected")])).toBe(true)
  })

  test("a checkout with a shop still working on its part isn't", () => {
    expect(orderGroupSettled([order("delivered"), order("packed")])).toBe(false)
    expect(orderGroupSettled([order("new")])).toBe(false)
  })
})
