import { describe, expect, test } from "bun:test"
import { deliveryChoices, deliveryEstimate } from "./delivery"

const rate = (id: string, amount: number, delivery_eta_time: string, tracking_level = 5) => ({
  id,
  amount,
  delivery_eta_time,
  tracking_level,
})

describe("deliveryChoices", () => {
  const bike = rate("bike", 1800, "2026-10-07T12:00:00+01:00")
  const express = rate("express", 4200, "2026-10-05T15:00:00+01:00")
  const nextDay = rate("next-day", 2600, "2026-10-06T12:00:00+01:00")
  const slow = rate("slow", 3000, "2026-10-09T12:00:00+01:00")

  test("offers the best value, the cheapest and the fastest, best value first", () => {
    expect(deliveryChoices([slow, bike, express, nextDay]).map((c) => [c.id, c.tags])).toEqual([
      ["next-day", ["best_value"]],
      ["bike", ["cheapest"]],
      ["express", ["fastest"]],
    ])
  })

  test("best value is the cheapest rate arriving within a day of the fastest", () => {
    const almostAsFast = rate("almost", 2000, "2026-10-06T14:00:00+01:00")
    expect(deliveryChoices([bike, express, almostAsFast]).find((c) => c.tags.includes("best_value"))?.id).toBe(
      "almost"
    )
  })

  test("among equally priced rates, best value goes to the better-tracked one", () => {
    const tracked = rate("tracked", 2600, "2026-10-06T13:00:00+01:00", 9)
    expect(deliveryChoices([nextDay, tracked, express]).find((c) => c.tags.includes("best_value"))?.id).toBe(
      "tracked"
    )
  })

  test("one rate that is all three is offered once with every tag", () => {
    expect(deliveryChoices([bike])).toEqual([{ ...bike, tags: ["best_value", "cheapest", "fastest"] }])
  })

  test("the fastest also being the best value is offered once", () => {
    expect(deliveryChoices([express, bike]).map((c) => [c.id, c.tags])).toEqual([
      ["express", ["best_value", "fastest"]],
      ["bike", ["cheapest"]],
    ])
  })

  test("no rates, no choices", () => {
    expect(deliveryChoices([])).toEqual([])
  })
})

describe("deliveryEstimate", () => {
  const now = new Date("2026-10-04T09:00:00+01:00")
  const lagos = "Africa/Lagos"

  test.each([
    ["later today", "2026-10-04T18:00:00+01:00", "Arrives today"],
    ["tomorrow", "2026-10-05T12:00:00+01:00", "Arrives tomorrow"],
    ["a later date by weekday and date", "2026-10-07T12:00:00+01:00", "Arrives Wed 7 Oct"],
  ])("reads %s", (_, eta, label) => {
    expect(deliveryEstimate(eta, now, lagos)).toBe(label)
  })

  test("counts days in the region's timezone, not the device's", () => {
    // 23:30 in Lagos is already the next day in UTC+2 but not in Lagos.
    expect(deliveryEstimate("2026-10-04T23:30:00+01:00", now, lagos)).toBe("Arrives today")
  })
})
