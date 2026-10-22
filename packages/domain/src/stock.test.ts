import { describe, expect, test } from "bun:test"
import { availableQuantity, stockShortfall } from "./stock"

const level = (stocked: number, reserved = 0) => ({ stocked_quantity: stocked, reserved_quantity: reserved })
const tracked = (parts: { required_quantity: number | null; levels: ReturnType<typeof level>[] }[]) => ({
  manage_inventory: true,
  allow_backorder: false,
  parts,
})

describe("availableQuantity", () => {
  test("is null for an offer whose stock isn't tracked", () => {
    expect(availableQuantity({ manage_inventory: false, allow_backorder: false, parts: [] })).toBeNull()
  })

  test("is null for an offer that allows backorders, however little is left", () => {
    expect(
      availableQuantity({ manage_inventory: true, allow_backorder: true, parts: [{ required_quantity: 1, levels: [level(0)] }] })
    ).toBeNull()
  })

  test("is what is stocked less what is reserved", () => {
    expect(availableQuantity(tracked([{ required_quantity: 1, levels: [level(10, 3)] }]))).toBe(7)
  })

  test("counts from the location with the most, never adding locations together", () => {
    expect(availableQuantity(tracked([{ required_quantity: 1, levels: [level(4), level(9, 2), level(5)] }]))).toBe(7)
  })

  test("is as many as the scarcest part allows, in whole units", () => {
    expect(
      availableQuantity(
        tracked([
          { required_quantity: 1, levels: [level(20)] },
          { required_quantity: 3, levels: [level(10)] },
        ])
      )
    ).toBe(3)
  })

  test("treats a part with no required quantity as needing one", () => {
    expect(availableQuantity(tracked([{ required_quantity: null, levels: [level(2)] }]))).toBe(2)
  })

  test("is never below zero when more is reserved than stocked", () => {
    expect(availableQuantity(tracked([{ required_quantity: 1, levels: [level(2, 5)] }]))).toBe(0)
  })

  test("is zero for a tracked offer with no stock anywhere", () => {
    expect(availableQuantity(tracked([]))).toBe(0)
    expect(availableQuantity(tracked([{ required_quantity: 1, levels: [] }]))).toBe(0)
  })
})

describe("stockShortfall", () => {
  test("is nothing when stock isn't tracked", () => {
    expect(stockShortfall(5, null)).toBeNull()
  })

  test("is nothing when enough is left", () => {
    expect(stockShortfall(3, 3)).toBeNull()
  })

  test("is sold out when none is left", () => {
    expect(stockShortfall(2, 0)).toEqual({ type: "sold_out" })
  })

  test("says how many are left when fewer than wanted are", () => {
    expect(stockShortfall(5, 2)).toEqual({ type: "short", left: 2 })
  })
})
