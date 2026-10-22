import { describe, expect, test } from "bun:test"
import { orderRowMeta } from "./order-row"

const LAGOS = "Africa/Lagos"
// Friday 23 October 2026, 9:41 in Lagos.
const now = new Date("2026-10-23T08:41:00Z")

describe("orderRowMeta", () => {
  test("a checkout placed today reads Today, its item count and its number", () => {
    expect(orderRowMeta({ createdAt: "2026-10-23T07:10:00Z", itemCount: 4, displayId: 2410 }, now, LAGOS)).toBe(
      "Today · 4 items · OJ-2410"
    )
  })

  test("one item reads in the singular", () => {
    expect(orderRowMeta({ createdAt: "2026-10-23T07:10:00Z", itemCount: 1, displayId: 2411 }, now, LAGOS)).toBe(
      "Today · 1 item · OJ-2411"
    )
  })

  test.each([
    ["2026-10-18T10:00:00Z", "Sun 18 Oct"],
    ["2026-10-02T10:00:00Z", "Fri 2 Oct"],
    ["2026-09-20T10:00:00Z", "20 Sep"],
    ["2025-12-28T10:00:00Z", "28 Dec 2025"],
  ])("a checkout placed %s reads %s", (createdAt, day) => {
    expect(orderRowMeta({ createdAt, itemCount: 3, displayId: 2301 }, now, LAGOS)).toBe(`${day} · 3 items · OJ-2301`)
  })

  test("the day is the buyer's, not UTC's", () => {
    // 23:30 UTC on the 22nd is already the 23rd in Lagos.
    expect(orderRowMeta({ createdAt: "2026-10-22T23:30:00Z", itemCount: 2, displayId: 2409 }, now, LAGOS)).toBe(
      "Today · 2 items · OJ-2409"
    )
  })
})
