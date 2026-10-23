import { describe, expect, test } from "bun:test"
import { asSentence } from "./sentence"

describe("asSentence", () => {
  test("ends what staff wrote with a full stop, so a note after it reads on", () => {
    expect(asSentence("Out of Ofada rice")).toBe("Out of Ofada rice.")
  })

  test("keeps the stop, question or exclamation mark they typed, without doubling it", () => {
    expect(asSentence("Sorry, we've run out of Ofada rice this week.")).toBe("Sorry, we've run out of Ofada rice this week.")
    expect(asSentence("Can you order again tomorrow?")).toBe("Can you order again tomorrow?")
    expect(asSentence("Sold out!")).toBe("Sold out!")
  })

  test("drops the spaces around it", () => {
    expect(asSentence("  Out of stock.  ")).toBe("Out of stock.")
  })

  test("leaves a closing quote or bracket after the stop", () => {
    expect(asSentence('They said "no more rice."')).toBe('They said "no more rice."')
    expect(asSentence("Out of stock (all sizes).")).toBe("Out of stock (all sizes).")
  })
})
