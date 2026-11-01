import { describe, expect, test } from "bun:test"
import {
  BUYER_ACTIVITY_FACTORY,
  buyerActivityContent,
  buyerActivityOrderId,
  buyerActivityPlan,
  buyerActivityRestarts,
  buyerActivityUrl,
  liveActivityPayloadBytes,
  MAX_ACTIVITY_CONTENT_BYTES,
} from "./buyer-activity"
import { buyerStatusPush } from "./buyer-push"
import { formatMoney } from "./money"

const order = { number: "OJ-2412", shop: "Iya Bisi Foodstuff", currency_code: "ngn" }

describe("liveActivityOutlived", () => {
  const START = new Date("2026-11-01T00:00:00.000Z")
  test("holds once iOS's 8 hours and 4 on the Lock Screen have passed", () => {
    expect(liveActivityOutlived(START, new Date("2026-11-01T11:59:00.000Z"))).toBe(false)
    expect(liveActivityOutlived(START, new Date("2026-11-01T12:00:00.000Z"))).toBe(true)
  })
})

describe("buyerActivityContent", () => {
  test("an accepted delivery is step 2 of the 8 on its order screen, Being prepared next", () => {
    expect(buyerActivityContent({ ...order, method: "delivery", state: "accepted" })).toEqual({
      number: "OJ-2412",
      shop: "Iya Bisi Foodstuff",
      method: "delivery",
      step: { label: "Accepted", short: "Accepted", tone: "info", icon: "box", index: 2, total: 8, next: "Being prepared" },
      code: null,
      outcome: null,
    })
  })

  test("an accepted pickup order is step 2 of 5", () => {
    const { step } = buyerActivityContent({ ...order, method: "pickup", state: "accepted" })
    expect(step).toMatchObject({ index: 2, total: 5, next: "Being prepared" })
  })

  test.each([
    ["picking", "Being prepared", "Preparing", 3, "Packed"],
    ["partially_available", "Being prepared", "Preparing", 3, "Packed"],
    ["label_booked", "Courier booked", "Booked", 5, "Picked up by the courier"],
    ["courier_confirmed", "Courier booked", "Booked", 5, "Picked up by the courier"],
    ["handed_to_courier", "Picked up by the courier", "Picked up", 6, "On its way"],
    ["in_transit", "On its way", "On its way", 7, "Delivered"],
  ] as const)("%s reads as the timeline's step, with its short label", (state, label, short, index, next) => {
    expect(buyerActivityContent({ ...order, method: "delivery", state }).step).toMatchObject({ label, short, index, next })
  })

  test("the truck replaces the box from Courier booked onwards", () => {
    expect(buyerActivityContent({ ...order, method: "delivery", state: "packed" }).step.icon).toBe("box")
    expect(buyerActivityContent({ ...order, method: "delivery", state: "label_booked" }).step.icon).toBe("truck")
  })

  test("the pickup code shows once the order is ready, and only then", () => {
    const ready = buyerActivityContent({ ...order, method: "pickup", state: "ready_for_pickup", pickup_code: "482913" })
    expect(ready.code).toBe("482 913")
    expect(ready.step).toMatchObject({ label: "Ready for pickup", short: "Ready", tone: "success", icon: "store", index: 4, total: 5, next: "Collected" })
    expect(buyerActivityContent({ ...order, method: "pickup", state: "picking", pickup_code: "482913" }).code).toBeNull()
  })

  test.each([
    ["delivery", "delivered", 8, 8],
    ["pickup", "collected", 5, 5],
  ] as const)("a %s %s ends with every step done", (method, state, index, total) => {
    const content = buyerActivityContent({ ...order, method, state })
    expect(content.outcome).toEqual({ kind: state })
    expect(content.step).toMatchObject({ index, total, next: null, icon: "check" })
  })

  test("a cancelled order says who cancelled, why, and the refund", () => {
    const content = buyerActivityContent({
      ...order,
      method: "delivery",
      state: "cancelled",
      cancellation: { by: "seller", reason: "items_unavailable", note: null },
      refund: 16300,
    })
    expect(content.step).toMatchObject({ label: "Cancelled by the shop", icon: "x", tone: "neutral", next: null })
    expect(content.outcome).toEqual({ kind: "cancelled", by: "seller", reason: "Items unavailable", refund: formatMoney(16300, "ngn") })
  })

  test("Oja's team cancelling with nothing paid has no refund", () => {
    const { outcome } = buyerActivityContent({
      ...order,
      method: "pickup",
      state: "cancelled",
      cancellation: { by: "operator", reason: "other", note: "Shop closed down" },
      refund: 0,
    })
    expect(outcome).toEqual({ kind: "cancelled", by: "operator", reason: "Shop closed down", refund: null })
  })

  test("not collected carries the refund and the fresh items that aren't refunded", () => {
    const content = buyerActivityContent({
      ...order,
      method: "pickup",
      state: "not_collected",
      refund: 5000,
      kept: [{ title: "Tomatoes", quantity: 2 }],
    })
    expect(content.step).toMatchObject({ label: "Not collected", short: "Not collected", icon: "x", index: 5, total: 5 })
    expect(content.outcome).toEqual({ kind: "not_collected", refund: formatMoney(5000, "ngn"), kept: "2 × Tomatoes" })
  })
})

describe("what each fulfilment state does to the activity", () => {
  test.each([
    ["new", "none", false, 5],
    ["rejected", "none", false, 5],
    ["accepted", "start", true, 10],
    ["picking", "update", false, 5],
    ["partially_available", "update", false, 5],
    ["packed", "update", false, 5],
    ["label_booked", "update", true, 10],
    ["courier_confirmed", "update", false, 5],
    ["handed_to_courier", "update", true, 10],
    ["in_transit", "update", false, 5],
    ["ready_for_pickup", "update", true, 10],
    ["delivered", "end", false, 10],
    ["collected", "end", false, 10],
    ["cancelled", "end", false, 10],
    ["not_collected", "end", false, 10],
  ] as const)("%s: %s, alert %s, priority %i", (state, action, alert, priority) => {
    expect(buyerActivityPlan(state)).toEqual({ action, alert, priority })
  })

  test("an update alerts exactly where the buyer already gets the state's push", () => {
    const order = { number: "OJ-1", shop: "Shop", rejected_by: null }
    for (const state of ["picking", "partially_available", "packed", "label_booked", "courier_confirmed", "handed_to_courier", "in_transit", "ready_for_pickup"] as const) {
      expect(buyerActivityPlan(state).alert).toBe(buyerStatusPush(state, order) !== null)
    }
  })
})

describe("restarting past iOS's 8 hours", () => {
  const HOUR = 60 * 60 * 1000
  const started = new Date("2026-11-01T08:00:00Z")
  const after = (hours: number) => new Date(started.getTime() + hours * HOUR)

  test("a pushed milestone about 7 hours or more after the start restarts it", () => {
    expect(buyerActivityRestarts("label_booked", started, after(7))).toBe(true)
    expect(buyerActivityRestarts("handed_to_courier", started, after(30))).toBe(true)
    expect(buyerActivityRestarts("ready_for_pickup", started, after(7))).toBe(true)
  })

  test("sooner, it's an ordinary update", () => {
    expect(buyerActivityRestarts("label_booked", started, after(6.9))).toBe(false)
  })

  test("a step with no push never restarts it, nor does an ending", () => {
    expect(buyerActivityRestarts("in_transit", started, after(30))).toBe(false)
    expect(buyerActivityRestarts("delivered", started, after(30))).toBe(false)
  })
})

describe("which shop order an activity is for", () => {
  test("its url opens the checkout's order screen and names the shop order", () => {
    const url = buyerActivityUrl("oja", "ordgrp_1", "order_2")
    expect(url).toBe("oja://order/ordgrp_1?shop_order=order_2")
    expect(buyerActivityOrderId(url)).toBe("order_2")
  })

  test("a url that names none reads as none", () => {
    expect(buyerActivityOrderId("oja://order/ordgrp_1")).toBeNull()
    expect(buyerActivityOrderId(null)).toBeNull()
  })
})

describe("Apple's 4 KB limit", () => {
  // Each counts for several bytes once its JSON is itself a string in the payload.
  const costly = (length: number) => '"\\😀\u0001\n'.repeat(length)
  const worst = {
    number: "OJ-2412",
    shop: costly(5000),
    currency_code: "ngn",
    method: "pickup",
    state: "cancelled",
    cancellation: { by: "seller", reason: "other", note: costly(5000) },
    refund: 16300,
  } as const

  test("an endless shop name and cancel note still fit, double-encoded", () => {
    const content = buyerActivityContent(worst)
    expect(liveActivityPayloadBytes(BUYER_ACTIVITY_FACTORY, content)).toBeLessThanOrEqual(MAX_ACTIVITY_CONTENT_BYTES)
    expect(MAX_ACTIVITY_CONTENT_BYTES).toBeLessThan(4096)
  })

  test("so do many fresh items with long names", () => {
    const kept = Array.from({ length: 200 }, (_, i) => ({ title: `${costly(50)} ${i}`, quantity: 1 }))
    const content = buyerActivityContent({ ...worst, state: "not_collected", kept, refund: 1 })
    expect(liveActivityPayloadBytes(BUYER_ACTIVITY_FACTORY, content)).toBeLessThanOrEqual(MAX_ACTIVITY_CONTENT_BYTES)
  })

  test("clipping ends with an ellipsis and doesn't split an emoji", () => {
    const { shop } = buyerActivityContent({ ...worst, shop: "😀".repeat(500), state: "delivered", method: "delivery" })
    expect(shop.endsWith("…")).toBe(true)
    expect(shop).not.toContain("\uFFFD")
    expect(Buffer.from(shop).toString()).toBe(shop)
  })

  test("a name that fits isn't touched", () => {
    expect(buyerActivityContent({ ...order, method: "delivery", state: "accepted" }).shop).toBe(order.shop)
  })

  test("line breaks and control characters in free text become spaces", () => {
    const { outcome } = buyerActivityContent({ ...worst, shop: "Shop", cancellation: { by: "seller", reason: "other", note: " Out\n\nof\u0001 rice " } })
    expect(outcome).toMatchObject({ reason: "Out of rice" })
  })
})
