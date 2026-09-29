import { getLastPaymentStatus } from "@mercurjs/core/workflows/order-group/utils/aggregate-status"

// A shop sees its own order: never another shop's price, nor what the buyer spent at other
// shops (docs/design.md). Mercur's vendor order reads break both for a checkout split across
// shops: each order carries the checkout's one shared payment, and a line's variant carries
// every shop's price for it (offers of a variant share its price set).

export type OrderTransaction = { amount: number; reference: string | null; reference_id: string | null }

/** The order's part of its checkout's payment: its total, and what was captured and refunded for it. */
export type OrderShare = { total: number; transactions: OrderTransaction[] }

type Refund = { id: string; amount?: number; [key: string]: unknown }
type Payment = { id: string; amount?: number; refunds?: Refund[]; [key: string]: unknown }
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

export type ShopPayment = { id: string; amount: number; refunds?: Refund[]; [key: string]: unknown }
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

const pick = (from: Record<string, unknown>, fields: string[]) =>
  Object.fromEntries(fields.filter((field) => field in from).map((field) => [field, from[field]]))

const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0)

/**
 * The checkout's payment collection cut down to the order's share. Captured and refunded come
 * from the order's own transactions, which the split records at the order's share; the rest is
 * scaled by that share. Mercur splits a checkout under one payment collection.
 */
function paymentShare(collection: PaymentCollection, share: OrderShare): ShopPaymentCollection {
  const own = (reference: string) => share.transactions.filter((t) => t.reference === reference)
  const captured = sum(own("capture").map((t) => t.amount))
  const refunded = sum(own("refund").map((t) => -t.amount))
  const ownRefundIds = new Set(own("refund").map((t) => t.reference_id))
  // Multiplied before dividing, so a share of the whole comes out exact.
  const [part, whole] = collection.captured_amount
    ? [captured, collection.captured_amount]
    : [share.total, collection.amount ?? 0]
  const scale = (amount: number | undefined) => (whole ? ((amount ?? 0) * part) / whole : 0)

  return {
    ...pick(collection, COLLECTION_FIELDS),
    amount: scale(collection.amount),
    authorized_amount: scale(collection.authorized_amount),
    captured_amount: captured,
    refunded_amount: refunded,
    payments: (collection.payments ?? []).map((payment) => ({
      ...pick(payment, PAYMENT_FIELDS),
      id: payment.id,
      amount: scale(payment.amount),
      ...(payment.refunds && { refunds: payment.refunds.filter((r) => ownRefundIds.has(r.id)) }),
    })),
  }
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
