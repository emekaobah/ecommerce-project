import { getLastPaymentStatus } from "@mercurjs/core/workflows/order-group/utils/aggregate-status"

// A shop sees its own order: never another shop's price, nor what the buyer spent at other
// shops (docs/design.md). Mercur's vendor order reads break both for a checkout split across
// shops: each order carries the checkout's one shared payment, and a line's variant carries
// every shop's price for it (offers of a variant share its price set).

export type OrderTransaction = { amount: number; reference: string | null; reference_id: string | null }

/** An order's transactions, each amount a number: the query graph reads them as big numbers. */
export const transactionsOf = (order: { transactions?: OrderTransaction[] | null }): OrderTransaction[] =>
  (order.transactions ?? []).map((t) => ({ ...t, amount: Number(t.amount) }))

/** The order's part of its checkout's payment: its total, and what was captured and refunded for it. */
export type OrderShare = { total: number; transactions: OrderTransaction[] }

type Refund = { id: string; amount?: number; [key: string]: unknown }
type Capture = { id: string; amount?: number; [key: string]: unknown }
export type Payment = { id: string; amount?: number; captures?: Capture[]; refunds?: Refund[]; [key: string]: unknown }
type PaymentCollection = {
  amount?: number
  authorized_amount?: number
  captured_amount?: number
  payments?: Payment[]
  [key: string]: unknown
}
type Price = { currency_code?: string; amount?: number; [key: string]: unknown }
type Line = {
  unit_price?: number
  compare_at_unit_price?: number | null
  variant?: { prices?: Price[]; [key: string]: unknown } | null
  [key: string]: unknown
}
export type VendorOrder = {
  currency_code?: string
  payment_status?: string
  payment_collections?: PaymentCollection[]
  cart?: { payment_collection?: PaymentCollection | null } | null
  items?: Line[]
  [key: string]: unknown
}

export type ShopPayment = { id: string; amount: number; captures?: Capture[]; refunds?: Refund[]; [key: string]: unknown }
export type ShopPaymentCollection = {
  amount: number
  authorized_amount: number
  captured_amount: number
  refunded_amount: number
  payments: ShopPayment[]
  [key: string]: unknown
}
export type ShopOrder = {
  currency_code?: string
  payment_status?: string
  payment_collections?: ShopPaymentCollection[]
  items?: Line[]
  [key: string]: unknown
}

// What the shop's order page needs of the payment; the rest (Paystack's record of the charge,
// the payment sessions) describes the whole checkout.
const COLLECTION_FIELDS = ["id", "currency_code", "status", "completed_at", "created_at", "updated_at", "metadata"]
const PAYMENT_FIELDS = [
  "id",
  "currency_code",
  "provider_id",
  "captured_at",
  "canceled_at",
  "created_at",
  "updated_at",
  "payment_collection_id",
]
const CAPTURE_FIELDS = ["id", "payment_id", "created_at", "created_by"]

const pick = (from: Record<string, unknown>, fields: string[]) =>
  Object.fromEntries(fields.filter((field) => field in from).map((field) => [field, from[field]]))

const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0)

/**
 * What the order's own transactions hold of the checkout's payment: the split records each
 * capture at the order's share, and a refund against the order.
 */
function ownMoney(share: OrderShare) {
  const own = (reference: string) => share.transactions.filter((t) => t.reference === reference)
  return {
    captured: sum(own("capture").map((t) => t.amount)),
    refunded: sum(own("refund").map((t) => -t.amount)),
    captures: new Map(own("capture").map((t) => [t.reference_id, t.amount])),
    refundIds: new Set(own("refund").map((t) => t.reference_id)),
  }
}

/** Scales the whole checkout's amounts to the order's part of it, exactly when it is all of one. */
const scaleTo = (part: number, whole: number) => (amount: number | undefined) =>
  // Multiplied before dividing, so a share of the whole comes out exact.
  whole ? ((amount ?? 0) * part) / whole : 0

function paymentView(payment: Payment, scale: (amount: number | undefined) => number, own: ReturnType<typeof ownMoney>) {
  return {
    ...pick(payment, PAYMENT_FIELDS),
    id: payment.id,
    amount: scale(payment.amount),
    ...(payment.captures && {
      captures: payment.captures
        .filter((c) => own.captures.has(c.id))
        .map((c) => ({ ...pick(c, CAPTURE_FIELDS), id: c.id, amount: own.captures.get(c.id) })),
    }),
    ...(payment.refunds && { refunds: payment.refunds.filter((r) => own.refundIds.has(r.id)) }),
  }
}

/**
 * The checkout's payment collection cut down to the order's share. Captured and refunded come
 * from the order's own transactions; the rest is scaled by that share. Mercur splits a
 * checkout under one payment collection.
 */
function paymentShare(collection: PaymentCollection, share: OrderShare): ShopPaymentCollection {
  const own = ownMoney(share)
  const scale = collection.captured_amount
    ? scaleTo(own.captured, collection.captured_amount)
    : scaleTo(share.total, collection.amount ?? 0)

  return {
    ...pick(collection, COLLECTION_FIELDS),
    amount: scale(collection.amount),
    authorized_amount: scale(collection.authorized_amount),
    captured_amount: own.captured,
    refunded_amount: own.refunded,
    payments: (collection.payments ?? []).map((payment) => paymentView(payment, scale, own)),
  }
}

/** A checkout's payment as a shop in it may see it: the shop's order's share (see `paymentShare`). */
export function shopPaymentView(payment: Payment, share: OrderShare): ShopPayment {
  const own = ownMoney(share)
  const captured = sum((payment.captures ?? []).map((c) => c.amount ?? 0))
  const scale = captured ? scaleTo(own.captured, captured) : scaleTo(share.total, payment.amount ?? 0)
  return paymentView(payment, scale, own)
}

/**
 * A line's variant carries only the line's own price: the shop's normal price when the line
 * was on sale, else what the buyer paid. The web vendor panel strikes the variant's price
 * through when it differs from the line's, so only a sale on the shop's own offer shows one.
 */
function ownLinePrice(line: Line, currencyCode: string | undefined): Line {
  if (!line.variant?.prices) return line
  const amount = line.compare_at_unit_price ?? line.unit_price
  const prices = currencyCode && amount != null ? [{ currency_code: currencyCode, amount }] : []
  return { ...line, variant: { ...line.variant, prices } }
}

/** A vendor order response as its shop may see it. */
export function shopOrderView(order: VendorOrder, share: OrderShare): ShopOrder {
  const { cart, payment_collections, ...rest } = order
  const collections = payment_collections ?? (cart?.payment_collection ? [cart.payment_collection] : undefined)
  const view: ShopOrder = { ...rest }
  if (rest.items) view.items = rest.items.map((line) => ownLinePrice(line, rest.currency_code))
  if (collections) {
    view.payment_collections = collections.map((collection) => paymentShare(collection, share))
    view.payment_status = getLastPaymentStatus(view as never)
  }
  return view
}
