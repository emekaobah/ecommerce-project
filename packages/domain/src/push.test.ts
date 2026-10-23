import { describe, expect, test } from "bun:test"
import { newOrderBanner, newOrderPush, newOrderTakeover, pushTarget } from "./push"

describe("pushTarget", () => {
  test("opens the screen a push names", () => {
    expect(pushTarget({ url: "/orders/order_123", order_id: "order_123" })).toEqual({
      path: "/orders/order_123",
      sellerId: null,
    })
  })

  test("names the shop a vendor push is about, so the app can act for it first", () => {
    expect(pushTarget({ url: "/orders/order_123", seller_id: "sel_1" })).toEqual({
      path: "/orders/order_123",
      sellerId: "sel_1",
    })
  })

  test.each([
    ["no data", undefined],
    ["no url", { order_id: "order_123" }],
    ["a url that isn't text", { url: 42 }],
    ["a link to another site", { url: "https://evil.example/orders/1" }],
    ["a protocol-relative link", { url: "//evil.example/orders/1" }],
    ["another app's scheme", { url: "ojabuyer://orders/1" }],
  ])("opens nothing for %s", (_, data) => {
    expect(pushTarget(data)).toBeNull()
  })
})

describe("newOrderPush", () => {
  test("reads a new order's push: the order and its shop", () => {
    expect(
      newOrderPush({ url: "/orders/order_123", order_id: "order_123", seller_id: "sel_1", kind: "new_order" })
    ).toEqual({ orderId: "order_123", sellerId: "sel_1" })
  })

  test("a new order's push without a shop still names the order", () => {
    expect(newOrderPush({ order_id: "order_123", kind: "new_order" })).toEqual({ orderId: "order_123", sellerId: null })
  })

  test.each([
    ["no data", undefined],
    ["another kind of push", { order_id: "order_123", kind: "accept_reminder" }],
    ["no kind", { order_id: "order_123" }],
    ["no order", { kind: "new_order" }],
    ["an order id that isn't text", { order_id: 7, kind: "new_order" }],
  ])("is not a new order for %s", (_, data) => {
    expect(newOrderPush(data)).toBeNull()
  })
})

describe("newOrderTakeover", () => {
  const push = { url: "/orders/order_123", order_id: "order_123", seller_id: "sel_1", kind: "new_order" }
  const phone = { mode: "takeover", signedIn: true, showing: null, answered: new Set<string>() } as const

  test("a new order's push opens the takeover on a phone set to it", () => {
    expect(newOrderTakeover(push, phone)).toEqual({ orderId: "order_123", sellerId: "sel_1" })
  })

  test("a phone set to banners shows the push as a banner", () => {
    expect(newOrderTakeover(push, { ...phone, mode: "banner" })).toBeNull()
  })

  test("nobody signed in: a banner, the takeover has nowhere to open", () => {
    expect(newOrderTakeover(push, { ...phone, signedIn: false })).toBeNull()
  })

  test("the order already showing isn't opened twice", () => {
    expect(newOrderTakeover(push, { ...phone, showing: "order_123" })).toBeNull()
  })

  test("another order arriving while one shows takes its place", () => {
    expect(newOrderTakeover(push, { ...phone, showing: "order_9" })).toEqual({ orderId: "order_123", sellerId: "sel_1" })
  })

  test("an order already answered on this phone never takes over again, even if its push comes again", () => {
    expect(newOrderTakeover(push, { ...phone, answered: new Set(["order_123"]) })).toBeNull()
  })

  test("any other push is a banner", () => {
    expect(newOrderTakeover({ ...push, kind: "accept_reminder" }, phone)).toBeNull()
  })
})

describe("newOrderBanner", () => {
  const push = { url: "/orders/order_123", order_id: "order_123", seller_id: "sel_1", kind: "new_order" }
  const phone = { mode: "takeover", signedIn: true, showing: null, answered: new Set<string>() } as const

  test("a takeover that can't open rings as a banner instead, never as another takeover", () => {
    expect(newOrderTakeover(newOrderBanner(push), phone)).toBeNull()
  })

  test("tapping the banner still opens the order, for its shop", () => {
    expect(pushTarget(newOrderBanner(push))).toEqual({ path: "/orders/order_123", sellerId: "sel_1" })
  })
})
