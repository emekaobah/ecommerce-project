import { rateToBook } from "../lib/label-booking"
import type { ShipbubbleQuote } from "../modules/shipbubble"

const rate = (courier_id: string, amount: number, delivery_eta_time: string): ShipbubbleQuote => ({
  id: `${courier_id}:${courier_id}`,
  request_token: "token_now",
  courier_id,
  courier_name: courier_id,
  service_code: courier_id,
  amount,
  currency: "ngn",
  delivery_eta: null,
  delivery_eta_time,
  tracking_level: null,
})

describe("the courier a label is booked with", () => {
  const chosen = rate("gig", 2500, "2026-10-09T12:00:00+01:00")
  const bike = rate("dellyman", 1800, "2026-10-10T18:00:00+01:00")
  const express = rate("kwik", 4200, "2026-10-08T15:00:00+01:00")
  const sameDay = rate("chowdeck", 3000, "2026-10-08T20:00:00+01:00")

  it("is the buyer's courier, at today's quote, when it still takes the parcel", () => {
    const today = { ...chosen, request_token: "token_today", amount: 2700 }
    expect(rateToBook([bike, today, express], chosen)).toBe(today)
  })

  it("is otherwise the cheapest arriving no later than the buyer's courier would have", () => {
    expect(rateToBook([bike, express, sameDay], chosen)).toBe(sameDay)
  })

  it("is otherwise the fastest", () => {
    const slow = rate("routely", 1500, "2026-10-12T12:00:00+01:00")
    expect(rateToBook([bike, slow], chosen)).toBe(bike)
  })

  it("is none when no courier takes the parcel", () => {
    expect(rateToBook([], chosen)).toBeUndefined()
  })
})
