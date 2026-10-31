import { describe, expect, test } from "bun:test"
import { rememberSearch } from "./recent-searches"

describe("rememberSearch", () => {
  test("puts the newest search first", () => {
    expect(rememberSearch(["palm oil", "ankara"], "ofada rice")).toEqual(["ofada rice", "palm oil", "ankara"])
  })

  test("moves a search made again to the front, once, whatever its case or spacing", () => {
    expect(rememberSearch(["ofada rice", "Palm Oil", "ankara"], "  palm oil ")).toEqual(["palm oil", "ofada rice", "ankara"])
  })

  test("keeps the last eight", () => {
    const eight = ["h", "g", "f", "e", "d", "c", "b", "a"]
    expect(rememberSearch(eight, "i")).toEqual(["i", "h", "g", "f", "e", "d", "c", "b"])
  })

  test("ignores a blank search", () => {
    expect(rememberSearch(["ankara"], "   ")).toEqual(["ankara"])
  })
})
