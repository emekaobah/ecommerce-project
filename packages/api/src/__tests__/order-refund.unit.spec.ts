import { RefundExceedsShareError, refundPlan, type OrderMoney } from "../lib/order-refund"

// A checkout split across shops has one Paystack payment; each order's share of it is what
// its own `capture` transactions hold, less its own refunds (#20).
describe("refundPlan", () => {
  const capture = (id: string, amount: number) => ({ amount, reference: "capture", reference_id: id })
  const refund = (id: string, amount: number) => ({ amount: -amount, reference: "refund", reference_id: id })

  const shared: OrderMoney = {
    transactions: [capture("capt_1", 6500)],
    paymentOfCapture: new Map([["capt_1", "pay_1"]]),
    paymentOfRefund: new Map(),
  }

  it("refunds the order's whole share when no amount is asked for", () => {
    expect(refundPlan(shared)).toEqual([{ payment_id: "pay_1", amount: 6500 }])
  })

  it("refunds a part of the share", () => {
    expect(refundPlan(shared, 2000)).toEqual([{ payment_id: "pay_1", amount: 2000 }])
  })

  it("leaves out what the order has already refunded", () => {
    const money: OrderMoney = {
      ...shared,
      transactions: [...shared.transactions, refund("ref_1", 2000)],
      paymentOfRefund: new Map([["ref_1", "pay_1"]]),
    }

    expect(refundPlan(money)).toEqual([{ payment_id: "pay_1", amount: 4500 }])
  })

  it("won't refund more than the order's share, less its refunds", () => {
    const money: OrderMoney = {
      ...shared,
      transactions: [...shared.transactions, refund("ref_1", 2000)],
      paymentOfRefund: new Map([["ref_1", "pay_1"]]),
    }

    expect(() => refundPlan(money, 4500.01)).toThrow(RefundExceedsShareError)
    expect(() => refundPlan(money, 4500.01)).toThrow(/4500/)
  })

  it("refunds nothing once the share is refunded", () => {
    const money: OrderMoney = {
      ...shared,
      transactions: [...shared.transactions, refund("ref_1", 6500)],
      paymentOfRefund: new Map([["ref_1", "pay_1"]]),
    }

    expect(refundPlan(money)).toEqual([])
  })

  it("refunds an order paid by several payments from each payment's own share", () => {
    const money: OrderMoney = {
      transactions: [capture("capt_1", 3000), capture("capt_2", 5000), refund("ref_1", 1000)],
      paymentOfCapture: new Map([
        ["capt_1", "pay_1"],
        ["capt_2", "pay_2"],
      ]),
      paymentOfRefund: new Map([["ref_1", "pay_1"]]),
    }

    expect(refundPlan(money)).toEqual([
      { payment_id: "pay_1", amount: 2000 },
      { payment_id: "pay_2", amount: 5000 },
    ])
    expect(refundPlan(money, 3000)).toEqual([
      { payment_id: "pay_1", amount: 2000 },
      { payment_id: "pay_2", amount: 1000 },
    ])
  })

  it("refuses a refund of nothing", () => {
    expect(() => refundPlan(shared, 0)).toThrow(/greater than 0/)
  })
})
