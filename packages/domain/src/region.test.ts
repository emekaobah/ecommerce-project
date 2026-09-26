import { describe, expect, test } from "bun:test"
import { selectRegion } from "./region"

const nigeria = { id: "reg_ng", countries: [{ iso_2: "ng" }] }
const ghana = { id: "reg_gh", countries: [{ iso_2: "gh" }] }

describe("selectRegion", () => {
  test("picks the region that serves the device's country", () => {
    expect(selectRegion([nigeria, ghana], "GH")).toBe(ghana)
  })

  test("falls back to the first region when the device's country isn't served", () => {
    expect(selectRegion([nigeria, ghana], "US")).toBe(nigeria)
    expect(selectRegion([nigeria, ghana], undefined)).toBe(nigeria)
  })

  test("returns nothing when the backend has no regions", () => {
    expect(selectRegion([], "NG")).toBeUndefined()
  })
})
