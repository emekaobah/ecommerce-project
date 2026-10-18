import { approvedBooking, decideLabel, rateToBook } from "../lib/label-booking"
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

describe("what booking a label comes to, with a ₦1,000 top-up cap", () => {
  const chosen = rate("gig", 2500, "2026-10-09T12:00:00+01:00")
  const quote = (rates: ShipbubbleQuote[]) => ({ rates, chosen, items: [{ id: "item_1", quantity: 2 }], cap: 1000, currency_code: "ngn" })
  const within = rate("faramove", 3500, "2026-10-09T10:00:00+01:00")
  const above = rate("kwik", 3501, "2026-10-08T15:00:00+01:00")
  const later = rate("dellyman", 1800, "2026-10-10T18:00:00+01:00")

  it("books a courier costing up to the cap more than the buyer's, recording what the buyer chose", () => {
    expect(decideLabel(quote([within, later]))).toEqual({
      action: "book",
      booking: {
        rate: { request_token: "token_now", courier_id: "faramove", service_code: "faramove", courier_name: "faramove", amount: 3500, delivery_eta_time: within.delivery_eta_time },
        chosen: { courier_id: "gig", service_code: "gig", courier_name: "gig", amount: 2500 },
        items: [{ id: "item_1", quantity: 2 }],
      },
    })
  })

  it("books nothing past the cap, and lists every courier cheapest first, saying which are within it", () => {
    expect(decideLabel(quote([above, later]))).toEqual({
      action: "choose",
      options: [
        expect.objectContaining({ courier_id: "dellyman", difference: -700, within_cap: true }),
        expect.objectContaining({ courier_id: "kwik", difference: 1001, within_cap: false }),
      ],
    })
  })

  it("asks Oja's team to approve a courier staff pick past the cap", () => {
    expect(decideLabel(quote([above, later]), { courier_id: "kwik", service_code: "kwik" })).toMatchObject({
      action: "approve",
      courier: { courier_id: "kwik", amount: 3501, checkout_amount: 2500, difference: 1001 },
    })
  })

  it("applies the cap to the buyer's own courier quoting dearer now", () => {
    expect(decideLabel(quote([{ ...chosen, amount: 4000 }]))).toMatchObject({ action: "choose" })
  })

  it("refuses a courier staff pick while booking would book one within the cap by itself", () => {
    expect(() => decideLabel(quote([within, later]), { courier_id: "dellyman", service_code: "dellyman" })).toThrow(
      "Book the label without choosing a courier"
    )
  })
})

describe("booking a courier Oja's team approved", () => {
  const chosen = rate("gig", 2500, "2026-10-09T12:00:00+01:00")
  const kwik = rate("kwik", 3501, "2026-10-08T15:00:00+01:00")
  const quote = (rates: ShipbubbleQuote[]) => ({ rates, chosen, items: [{ id: "item_1", quantity: 2 }], cap: 1000, currency_code: "ngn" })
  const approved = { courier_id: "kwik", service_code: "kwik", amount: 3501 }

  it("books it at its price now, up to the price staff asked for", () => {
    expect(approvedBooking(quote([{ ...kwik, amount: 3400 }]), approved).rate).toMatchObject({ courier_id: "kwik", amount: 3400 })
    expect(approvedBooking(quote([kwik]), approved).rate).toMatchObject({ courier_id: "kwik", amount: 3501 })
  })

  it("refuses it once it costs more than staff asked for, so Oja's team decline it", () => {
    expect(() => approvedBooking(quote([{ ...kwik, amount: 3600 }]), approved)).toThrow("Decline it")
  })

  it("refuses it once it no longer quotes", () => {
    expect(() => approvedBooking(quote([chosen]), approved)).toThrow("no longer collects")
  })
})
