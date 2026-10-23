import { describe, expect, test } from "bun:test"
import { orderNumber } from "./order-number"

describe("orderNumber", () => {
  test("a checkout's number reads as the shop and Oja's support say it", () => {
    expect(orderNumber(2410)).toBe("OJ-2410")
  })

  test("an early number isn't padded", () => {
    expect(orderNumber(7)).toBe("OJ-7")
  })
})
