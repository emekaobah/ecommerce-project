import { numbersIn } from "../../integration-tests/helpers/numbers"
import { ownPaymentStatus, shopOrderView, shopPaymentView } from "../lib/shop-order"

// One Paystack payment of ₦42,800 paid for a checkout split into a ₦30,500 and a ₦12,300 order.
const collection = () => ({
  id: "pay_col_1",
  currency_code: "ngn",
  status: "completed",
  amount: 42800,
  authorized_amount: 42800,
  captured_amount: 42800,
  refunded_amount: 0,
  raw_amount: { value: "42800", precision: 20 },
  payment_sessions: [{ id: "payses_1", amount: 42800, data: { amount: 4280000 } }],
  payments: [
    {
      id: "pay_1",
      provider_id: "pp_paystack_paystack",
      amount: 42800,
      raw_amount: { value: "42800", precision: 20 },
      captured_at: "2026-09-29T08:14:14.361Z",
      canceled_at: null,
      data: { amount: 4280000, reference: "ref_1" },
      payment_session: { id: "payses_1", amount: 42800 },
      refunds: [] as { id: string; amount: number }[],
    },
  ],
})
const order = (overrides: Record<string, unknown> = {}) => ({
  id: "order_2",
  currency_code: "ngn",
  payment_status: "captured",
  payment_collections: [collection()],
  items: [],
  ...overrides,
})
const share = { total: 12300, transactions: [{ amount: 12300, reference: "capture", reference_id: "capt_1" }] }

describe("shopOrderView: the payment", () => {
  it("shows the order's own share of the checkout's payment", () => {
    const [seen] = shopOrderView(order(), share).payment_collections!

    expect(seen).toMatchObject({ amount: 12300, authorized_amount: 12300, captured_amount: 12300, refunded_amount: 0 })
    expect(seen.payments.map((p) => p.amount)).toEqual([12300])
  })

  it("leaves out every figure of the whole checkout, including Paystack's own record of it", () => {
    const seen = shopOrderView(order(), share)

    expect(numbersIn(seen)).not.toContain(42800)
    expect(numbersIn(seen)).not.toContain(4280000)
  })

  it("reads the payment through the order's cart, where split orders keep it", () => {
    const { payment_collections, ...rest } = order()

    const seen = shopOrderView({ ...rest, cart: { payment_collection: payment_collections[0] } }, share)

    expect(seen).not.toHaveProperty("cart")
    expect(seen.payment_collections!.map((c) => c.captured_amount)).toEqual([12300])
    expect(seen.payment_status).toBe("captured")
  })

  it("shows only the order's own refunds, and its status from them", () => {
    const refunded = collection()
    refunded.refunded_amount = 20000
    refunded.payments[0].refunds = [
      { id: "ref_other", amount: 18000 },
      { id: "ref_own", amount: 2000 },
    ]
    const withRefund = {
      ...share,
      transactions: [...share.transactions, { amount: -2000, reference: "refund", reference_id: "ref_own" }],
    }

    const seen = shopOrderView(order({ payment_collections: [refunded] }), withRefund)

    const [own] = seen.payment_collections!
    expect(own.refunded_amount).toBe(2000)
    expect(own.payments[0].refunds!.map((r) => r.id)).toEqual(["ref_own"])
    expect(seen.payment_status).toBe("partially_refunded")
  })

  it("leaves an order without a payment alone", () => {
    expect(shopOrderView({ id: "order_2", items: [] }, share)).toEqual({ id: "order_2", items: [] })
  })
})

describe("ownPaymentStatus", () => {
  // The ₦30,500 order was refunded in full; the checkout's payment reads partially refunded.
  const refunded = { ...collection(), refunded_amount: 30500 }

  it("reads an order refunded in full Refunded, and the checkout's other order Captured", () => {
    const other = {
      total: 30500,
      transactions: [
        { amount: 30500, reference: "capture", reference_id: "capt_2" },
        { amount: -30500, reference: "refund", reference_id: "ref_2" },
      ],
    }

    expect(ownPaymentStatus({ currency_code: "ngn" }, [refunded], other)).toBe("refunded")
    expect(ownPaymentStatus({ currency_code: "ngn" }, [refunded], share)).toBe("captured")
  })
})

describe("shopOrderView: the order's lines", () => {
  // Two shops' offers of one variant share its price set: ₦10,500 is the other shop's.
  const variant = () => ({
    id: "variant_1",
    prices: [
      { id: "price_rival", currency_code: "ngn", amount: 10500 },
      { id: "price_own", currency_code: "ngn", amount: 9800 },
    ],
  })

  it("gives a line's variant only the line's own price, so nothing is struck through", () => {
    const seen = shopOrderView(order({ items: [{ unit_price: 9800, compare_at_unit_price: null, variant: variant() }] }), share)

    expect(seen.items![0].variant!.prices).toEqual([{ currency_code: "ngn", amount: 9800 }])
  })

  it("keeps the shop's normal price to strike through when its own offer was on sale", () => {
    const seen = shopOrderView(order({ items: [{ unit_price: 9000, compare_at_unit_price: 9800, variant: variant() }] }), share)

    expect(seen.items![0].variant!.prices).toEqual([{ currency_code: "ngn", amount: 9800 }])
  })

  it("leaves a line whose variant prices weren't asked for alone", () => {
    const seen = shopOrderView(order({ items: [{ unit_price: 9800, variant: { id: "variant_1" } }] }), share)

    expect(seen.items![0].variant).toEqual({ id: "variant_1" })
  })
})

describe("shopPaymentView", () => {
  const payment = () => ({
    ...collection().payments[0],
    captures: [{ id: "capt_1", amount: 42800, raw_amount: { value: "42800", precision: 20 } }],
  })

  it("shows a shop the order's share of the checkout's payment and its capture", () => {
    const seen = shopPaymentView(payment(), share)

    expect(seen.amount).toBe(12300)
    expect(seen.captures).toEqual([{ id: "capt_1", amount: 12300 }])
    expect(numbersIn(seen)).not.toContain(42800)
    expect(numbersIn(seen)).not.toContain(4280000)
  })

  it("shows none of the payment's refunds made for other orders", () => {
    const refunded = { ...payment(), refunds: [{ id: "ref_other", amount: 18000 }] }

    expect(shopPaymentView(refunded, share).refunds).toEqual([])
  })
})
