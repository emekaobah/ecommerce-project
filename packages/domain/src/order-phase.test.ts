import { describe, expect, test } from "bun:test"
import type { FulfilmentState } from "./fulfilment"
import { orderPhase, type PhaseRefund } from "./order-phase"

const UNFINISHED: FulfilmentState[] = [
  "new",
  "accepted",
  "picking",
  "partially_available",
  "packed",
  "label_booked",
  "courier_confirmed",
  "handed_to_courier",
  "in_transit",
  "ready_for_pickup",
]
const FINAL: FulfilmentState[] = ["rejected", "cancelled", "delivered", "collected", "not_collected"]

const needingAccount: PhaseRefund = { status: "needs-attention", handed_over: false }

describe("orderPhase", () => {
  test.each(UNFINISHED)("keeps a %s order in progress", (state) => {
    expect(orderPhase(state, [])).toBe("in_progress")
  })

  test.each(FINAL)("puts a %s order in the past", (state) => {
    expect(orderPhase(state, [])).toBe("past")
  })

  test.each(FINAL)("keeps a %s order in progress while a refund waits on the buyer's bank account", (state) => {
    expect(orderPhase(state, [{ status: "processed", handed_over: false }, needingAccount])).toBe("in_progress")
  })

  test.each<[string, PhaseRefund]>([
    ["pending", { status: "pending", handed_over: false }],
    ["processing", { status: "processing", handed_over: false }],
    ["processed", { status: "processed", handed_over: false }],
    // A refund that failed is owed to the buyer again; the retry job or Oja's team sends it.
    ["failed or owed", { status: "failed", handed_over: false }],
    ["with Oja's team", { status: "needs-attention", handed_over: true }],
  ])("doesn't hold a finished order for a refund %s", (_, refund) => {
    expect(orderPhase("delivered", [refund])).toBe("past")
  })
})
