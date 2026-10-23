import { describe, expect, test } from "bun:test"
import { itemsLabel } from "./items-label"

describe("itemsLabel", () => {
  test("one item", () => expect(itemsLabel(1)).toBe("1 item"))
  test("several items", () => expect(itemsLabel(3)).toBe("3 items"))
  test("none", () => expect(itemsLabel(0)).toBe("0 items"))
})

test("items of a kind: 1 sold-out item, 2 sold-out items", () => {
  expect(itemsLabel(1, "sold-out")).toBe("1 sold-out item")
  expect(itemsLabel(2, "sold-out")).toBe("2 sold-out items")
})
