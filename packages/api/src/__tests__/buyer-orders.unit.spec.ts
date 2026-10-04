import { buyerRefund } from "../lib/buyer-orders"

// What a buyer sees of an order's refunds (#17): the order's `order_refund` rows, one per
// refund made, summed into one amount and where it is.
describe("buyerRefund", () => {
  let at = 0
  const row = (amount: number, status: string) => ({ amount, status, created_at: new Date(Date.UTC(2026, 9, 1, 0, at++)) })

  it("is nothing while the order hasn't been refunded", () => {
    expect(buyerRefund([])).toBeNull()
  })

  it("is the refund and Paystack's word on it", () => {
    expect(buyerRefund([row(12300, "pending")])).toEqual({ amount: 12300, status: "pending" })
    expect(buyerRefund([row(12300, "processed")])).toEqual({ amount: 12300, status: "processed" })
  })

  it("adds up several refunds, and is on its way until all of them are through", () => {
    expect(buyerRefund([row(1000, "processed"), row(2000, "processing")])).toEqual({ amount: 3000, status: "processing" })
    expect(buyerRefund([row(1000, "pending"), row(2000, "processed")])).toEqual({ amount: 3000, status: "pending" })
    expect(buyerRefund([row(1000, "processed"), row(2000, "processed")])).toEqual({ amount: 3000, status: "processed" })
  })

  it("is delayed while a refund that failed waits to be made again", () => {
    expect(buyerRefund([row(12300, "failed")])).toEqual({ amount: 12300, status: "failed" })
    expect(buyerRefund([row(1000, "processed"), row(2000, "failed")])).toEqual({ amount: 3000, status: "failed" })
  })

  it("counts a refund that failed again once, not once per attempt", () => {
    expect(buyerRefund([row(12300, "failed"), row(12300, "failed")])).toEqual({ amount: 12300, status: "failed" })
    expect(buyerRefund([row(1000, "processed"), row(2000, "failed"), row(2000, "failed")])).toEqual({ amount: 3000, status: "failed" })
  })

  it("leaves out a failed refund once it has been made again", () => {
    expect(buyerRefund([row(12300, "failed"), row(12300, "pending")])).toEqual({ amount: 12300, status: "pending" })
  })

  it("needs attention when any refund does", () => {
    expect(buyerRefund([row(1000, "needs-attention"), row(2000, "failed")])).toEqual({ amount: 3000, status: "needs-attention" })
  })
})
