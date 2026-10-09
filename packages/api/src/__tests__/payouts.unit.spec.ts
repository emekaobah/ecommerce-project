import { owedBack, payoutOf, recover } from "../lib/payouts"

// A shop is paid what the buyer kept of its order, less the delivery fee (Oja pays the courier
// from its own wallet) and a flat 10% commission on the rest (#29).
describe("payoutOf", () => {
  const capture = (amount: number) => ({ amount, reference: "capture", reference_id: "capt" })
  const refund = (amount: number) => ({ amount: -amount, reference: "refund", reference_id: "ref" })

  it("pays the goods the buyer paid for, less 10%; Oja keeps the delivery fee", () => {
    expect(payoutOf({ transactions: [capture(6500)], delivery: 1500 })).toEqual({
      paid: 6500,
      refunded: 0,
      delivery: 1500,
      commission: 500,
      amount: 4500,
    })
  })

  it("takes refunds off before the commission, so Oja's 10% is only of what the buyer kept", () => {
    expect(payoutOf({ transactions: [capture(6500), refund(2000)], delivery: 1500 })).toMatchObject({
      refunded: 2000,
      commission: 300,
      amount: 2700,
    })
  })

  it("rounds the commission to the kobo", () => {
    expect(payoutOf({ transactions: [capture(1000.05)], delivery: 0 })).toMatchObject({ commission: 100.01, amount: 900.04 })
  })

  it("pays nothing when everything was refunded", () => {
    expect(payoutOf({ transactions: [capture(6500), refund(6500)], delivery: 1500 })).toMatchObject({
      commission: 0,
      amount: 0,
    })
  })

  it("ignores transactions that are neither captures nor refunds", () => {
    expect(
      payoutOf({ transactions: [capture(2000), { amount: 50, reference: "credit_line", reference_id: "x" }], delivery: 0 })
    ).toMatchObject({ paid: 2000, amount: 1800 })
  })
})

// A refund made after an order was paid out is taken from the shop's next payout (#29).
describe("owedBack", () => {
  it("is what was paid out beyond what each order is now owed, less what was already taken back", () => {
    expect(
      owedBack([
        { amount: 4500, recovered: 0, owed: 2700 },
        { amount: 900, recovered: 1000, owed: 900 },
      ])
    ).toBe(800)
  })

  it("is nothing when no paid-out order was refunded since", () => {
    expect(owedBack([{ amount: 4500, recovered: 0, owed: 4500 }])).toBe(0)
  })

  it("goes below zero when more was taken back than is owed, e.g. a refund that later failed", () => {
    expect(owedBack([{ amount: 4500, recovered: 1800, owed: 4500 }])).toBe(-1800)
  })
})

describe("recover", () => {
  it("takes what the shop owes back from a payout", () => {
    expect(recover(4500, 800)).toEqual({ recovered: 800, transfer: 3700 })
  })

  it("takes at most the whole payout, leaving the rest owed for the next", () => {
    expect(recover(500, 800)).toEqual({ recovered: 500, transfer: 0 })
  })

  it("gives back what was taken back too much", () => {
    expect(recover(4500, -1800)).toEqual({ recovered: -1800, transfer: 6300 })
  })
})
