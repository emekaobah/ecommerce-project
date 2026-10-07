import { describe, expect, test } from "bun:test"
import { pushTarget } from "./push"

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
