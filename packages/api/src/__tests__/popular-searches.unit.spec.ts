import { isBlockedSearch, normaliseSearch } from "../lib/popular-searches"

describe("normaliseSearch", () => {
  it("lower-cases, trims and collapses spaces, so one search is counted as one term", () => {
    expect(normaliseSearch("  Ofada   RICE\t5kg ")).toBe("ofada rice 5kg")
  })

  it("cuts a very long term to 100 characters", () => {
    expect(normaliseSearch("a".repeat(150))).toHaveLength(100)
  })
})

describe("isBlockedSearch", () => {
  it("blocks a term with a blocklisted word", () => {
    expect(isBlockedSearch("shit rice")).toBe(true)
  })

  it("matches whole words only, so a word holding one isn't blocked", () => {
    expect(isBlockedSearch("glass bowl")).toBe(false)
    expect(isBlockedSearch("brass")).toBe(false)
  })
})
