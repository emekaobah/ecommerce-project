import { describe, expect, test } from "bun:test"
import { buyerActivityContent, buyerActivityUrl } from "./buyer-activity"
import {
  buyerLiveUpdateMessage,
  buyerLiveUpdateView,
  LIVE_UPDATE_TTL_SECONDS,
  readLiveUpdateMessage,
  readVendorLiveUpdateMessage,
  vendorLiveUpdateMessage,
  vendorLiveUpdateView,
} from "./live-update"
import { formatMoney } from "./money"
import type { VendorActivityContent } from "./vendor-activity"

const order = { number: "OJ-2412", shop: "Iya Bisi Foodstuff", currency_code: "ngn" }
const url = buyerActivityUrl("oja", "group_1", "order_1")
const HOUR = 60 * 60 * 1000

const message = (content: ReturnType<typeof buyerActivityContent>) => buyerLiveUpdateMessage({ action: "show", orderId: "order_1", url, content, at: 1000 })

describe("buyerLiveUpdateView, against the catalogue's drawings", () => {
  test("in progress: the step as the title, the shop and next step as the text, the chip saying the step", () => {
    const view = buyerLiveUpdateView(message(buyerActivityContent({ ...order, method: "delivery", state: "picking" })))
    expect(view).toMatchObject({
      id: "order_1",
      revision: 1000,
      url,
      title: "Being prepared",
      text: "Iya Bisi Foodstuff · Step 3 of 8 · Next: Packed",
      subText: "OJ-2412",
      chip: "3 of 8",
      icon: "box",
      ongoing: true,
      timeoutMs: 12 * HOUR,
      countdownTo: null,
    })
  })

  test("in progress: a segment between steps, the tracker where the order is", () => {
    const { progress, olderBar } = buyerLiveUpdateView(message(buyerActivityContent({ ...order, method: "delivery", state: "picking" })))
    expect(progress?.segments).toEqual(Array(7).fill({ length: 1 }))
    // More than the 4 Android draws: it would stop part-way along.
    expect(progress?.points).toEqual([])
    expect(progress?.position).toBe(2)
    expect(progress?.tracker).toBe("box")
    expect(progress?.styledByProgress).toBe(true)
    // Older Android fills with the step out of the path's steps.
    expect(olderBar).toEqual({ max: 8, current: 3 })
  })

  test("a pickup's shorter path has a point at each step after the first", () => {
    const { progress } = buyerLiveUpdateView(message(buyerActivityContent({ ...order, method: "pickup", state: "accepted" })))
    expect(progress?.segments).toHaveLength(4)
    expect(progress?.points).toEqual([1, 2, 3, 4])
  })

  test("on its way: the tracker and chip become the truck", () => {
    const view = buyerLiveUpdateView(message(buyerActivityContent({ ...order, method: "delivery", state: "in_transit" })))
    expect(view).toMatchObject({ title: "On its way", chip: "7 of 8", icon: "truck", text: "Iya Bisi Foodstuff · Step 7 of 8 · Next: Delivered" })
    expect(view.progress?.tracker).toBe("truck")
  })

  test("ready for pickup: the code in the text and, unspaced, in the chip", () => {
    const view = buyerLiveUpdateView(
      message(buyerActivityContent({ ...order, shop: "Ikeja Gadget Hub", method: "pickup", state: "ready_for_pickup", pickup_code: "482913" }))
    )
    expect(view).toMatchObject({ title: "Ready for pickup", text: "Code 482 913 · Show this code at Ikeja Gadget Hub.", chip: "482913", icon: "store", ongoing: true })
    expect(view.progress).not.toBeNull()
  })

  test("delivered: dismissible, no chip, no bar, and gone after the same short time as on iOS", () => {
    const view = buyerLiveUpdateView(message(buyerActivityContent({ ...order, method: "delivery", state: "delivered" })))
    expect(view).toEqual({
      id: "order_1",
      revision: 1000,
      url,
      title: "Delivered",
      text: "Your order from Iya Bisi Foodstuff has arrived.",
      subText: "OJ-2412",
      chip: null,
      icon: "bag",
      ongoing: false,
      timeoutMs: 30 * 60 * 1000,
      progress: null,
      olderBar: null,
      countdownTo: null,
      color: expect.anything(),
    })
  })

  test("collected says so", () => {
    const view = buyerLiveUpdateView(message(buyerActivityContent({ ...order, method: "pickup", state: "collected" })))
    expect(view.text).toBe("You collected your order from Iya Bisi Foodstuff. Your receipt is in your email.")
  })

  test("not collected says what's refunded and which fresh items aren't", () => {
    const view = buyerLiveUpdateView(
      message(
        buyerActivityContent({ ...order, method: "pickup", state: "not_collected", refund: 12000, kept: [{ title: "Fresh Tomatoes 1kg", quantity: 1 }] })
      )
    )
    expect(view).toMatchObject({ title: "Not collected", ongoing: false, progress: null, chip: null })
    expect(view.text).toBe(`It wasn't collected in time. You'll be refunded ${formatMoney(12000, "ngn")}. Fresh items aren't refunded: 1 × Fresh Tomatoes 1kg.`)
  })

  test("cancelled gives the reason and the refund", () => {
    const view = buyerLiveUpdateView(
      message(buyerActivityContent({ ...order, method: "delivery", state: "cancelled", refund: 5000, cancellation: { by: "seller", reason: "items_unavailable", note: null } }))
    )
    expect(view).toMatchObject({ title: "Cancelled by the shop", ongoing: false, progress: null, chip: null })
    expect(view.text).toBe(`Items unavailable. You'll be refunded ${formatMoney(5000, "ngn")}.`)
  })
})

describe("readLiveUpdateMessage", () => {
  const sent = message(buyerActivityContent({ ...order, method: "delivery", state: "picking" }))

  test("reads what the backend sent, from the JSON string the push carries it in", () => {
    expect(readLiveUpdateMessage({ data: { dataString: JSON.stringify(sent) } })).toEqual(sent)
  })

  test.each([
    ["a normal push's data", { data: { dataString: JSON.stringify({ url: "/order/1" }) } }],
    ["no data string", { data: {} }],
    ["a tap on a notification", { actionIdentifier: "x", notification: {} }],
    ["JSON that doesn't parse", { data: { dataString: "{" } }],
  ])("ignores %s", (_, payload) => {
    expect(readLiveUpdateMessage(payload)).toBeNull()
  })
})

test("a message outlives a delayed phone by no more than the notification would have stayed", () => {
  expect(LIVE_UPDATE_TTL_SECONDS).toBe(12 * 60 * 60)
})

describe("the shop as a notification", () => {
  const COUNTS = { new: 2, picking: 1, ready: 3, out: 4 }
  const DEADLINE = "2026-11-01T14:12:08.000Z"
  const shopMessage = (content: Partial<VendorActivityContent> = {}, action: "show" | "remove" = "show") =>
    vendorLiveUpdateMessage({
      action,
      sellerId: "sel_1",
      url: "ojavendor://shop-orders/sel_1",
      content: { shop: "Iya Bisi Foodstuff", counts: COUNTS, deadline: DEADLINE, urgent: false, ...content },
      at: 1000,
    })
  const view = (content: Partial<VendorActivityContent> = {}) => vendorLiveUpdateView(shopMessage(content))

  test("says what the drawing says: new orders in the title, the rest in the text, the shop in the header", () => {
    expect(view()).toMatchObject({
      id: "sel_1",
      revision: 1000,
      url: "ojavendor://shop-orders/sel_1",
      title: "2 new orders to accept",
      text: "1 picking · 3 ready · 4 out",
      subText: "Iya Bisi Foodstuff",
      ongoing: true,
    })
    expect(view({ counts: { ...COUNTS, new: 1 } }).title).toBe("1 new order to accept")
    expect(view({ counts: { ...COUNTS, new: 0 }, deadline: null }).title).toBe("No new orders")
  })

  test("shows counts over 99 as 99+, like the Lock Screen", () => {
    const { title, text } = view({ counts: { new: 100, picking: 120, ready: 99, out: 0 } })
    expect(title).toBe("99+ new orders to accept")
    expect(text).toBe("99+ picking · 99 ready · 0 out")
  })

  test("counts down to the deadline by the native timer, in the header and the chip", () => {
    const shown = view()
    expect(shown.countdownTo).toBe(Date.parse(DEADLINE))
    // A chip with its own text would hide the timer Android draws there.
    expect(shown.chip).toBeNull()
    expect(shown.icon).toBe("clock")
  })

  test("has no countdown with no deadline, and the chip keeps only the icon", () => {
    const shown = view({ counts: { ...COUNTS, new: 0 }, deadline: null })
    expect(shown.countdownTo).toBeNull()
    expect(shown.chip).toBeNull()
    expect(shown.icon).toBe("bag")
  })

  test("turns ember in the last two hours", () => {
    expect(view({ urgent: true }).color).toEqual({ light: "#84391A", dark: "#F0A474" })
    expect(view({ urgent: false }).color).toEqual({ light: "#1B2559", dark: "#AEB8FF" })
  })

  test("splits the bar by stage, sized by each count, with no dimming or tracker: it is not progress", () => {
    expect(view().progress).toEqual({
      segments: [
        { length: 2, color: { light: "#C98A1A", dark: "#F2C76B" } },
        { length: 1, color: { light: "#1B2559", dark: "#AEB8FF" } },
        { length: 3, color: { light: "#186441", dark: "#6FD6A0" } },
        { length: 4, color: { light: "#494F66", dark: "#B4B4BC" } },
      ],
      points: [],
      position: 10,
      tracker: null,
      styledByProgress: false,
    })
  })

  test("leaves empty stages out of the bar", () => {
    const { progress } = view({ counts: { new: 0, picking: 2, ready: 1, out: 5 }, deadline: null })
    expect(progress?.segments.map((segment) => segment.length)).toEqual([2, 1, 5])
    expect(progress?.position).toBe(8)
  })

  test("has no bar with no orders at all, as Android needs a segment to draw: the text shows instead", () => {
    expect(view({ counts: { new: 0, picking: 0, ready: 0, out: 0 }, deadline: null }).progress).toBeNull()
  })

  test("older Android has no bar, as drawn", () => {
    expect(view().olderBar).toBeNull()
  })

  test("reads a shop message from what the notification task was given, and nothing else", () => {
    const message = shopMessage()
    expect(readVendorLiveUpdateMessage({ data: { dataString: JSON.stringify(message) } })).toEqual(message)
    expect(readVendorLiveUpdateMessage({ data: { dataString: JSON.stringify({ url: "/orders" }) } })).toBeNull()
    expect(readVendorLiveUpdateMessage({ data: { dataString: JSON.stringify({ live_update: "buyer_shop_order" }) } })).toBeNull()
    expect(readVendorLiveUpdateMessage(null)).toBeNull()
  })
})
