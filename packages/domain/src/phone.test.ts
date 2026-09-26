import { describe, expect, test } from "bun:test"
import { toE164 } from "./phone"

describe("toE164", () => {
  test("accepts the ways Nigerian numbers are commonly written", () => {
    expect(toE164("0803 123 4567", "NG")).toBe("+2348031234567")
    expect(toE164("+234 803 123 4567", "ng")).toBe("+2348031234567")
    expect(toE164("234-803-123-4567", "NG")).toBe("+2348031234567")
    expect(toE164("8031234567", "NG")).toBe("+2348031234567")
  })

  test("rejects numbers of the wrong length", () => {
    expect(toE164("0803 123 456", "NG")).toBeNull()
    expect(toE164("0803 123 45678", "NG")).toBeNull()
    expect(toE164("", "NG")).toBeNull()
  })
})
