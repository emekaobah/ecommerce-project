import { PRODUCT_NAME } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { processPayoutForWebhookWorkflow } from "@mercurjs/core/workflows"
import { PayoutStatus, type PayoutWebhookAction } from "@mercurjs/types"
import { paystackClient } from "../modules/paystack"
// Every amount is worked out in kobo (the currency's subunit) to stay exact.
import { fromSubunit, toSubunit, UNSETTLED_REFUND_STATUSES } from "../modules/paystack/client"
import { payoutStatusOf } from "../modules/paystack-payout/service"
import { SHOP_BANK_ACCOUNT_MODULE, type ShopBankAccountModuleService } from "../modules/shop-bank-account"
import { ojaFundedDiscount, ojaSharesOf, taxRateOf } from "./discount-funding"
import { fulfilmentService, fulfilmentsOf, givesShareBack, type OrderRefundRecord } from "./order-fulfilment"
import { owedToBuyerOf, shareLeft, type OrderSummary } from "./order-refund"
import { transactionsOf, type OrderTransaction } from "./shop-order"

// What a shop is paid for an order (#29): Paystack Transfers after delivery, worked out here
// rather than from Mercur's commission lines, which an order's refunds don't change.

/** Oja's commission, as a percentage of the goods the buyer kept. Also the global commission rate (seed). */
export const COMMISSION_PERCENT = 10

export type OrderPayout = {
  /** What was captured for the order: its share of its checkout's payment. */
  paid: number
  /**
   * What has been refunded of its items since, and what the order still owes its buyer for
   * lines an order edit removed (#22, #32) whose refund failed or hasn't been made. A refund of
   * delivery is Oja's, and isn't counted.
   */
  refunded: number
  /** What the buyer paid for delivery, which Oja keeps: it pays the courier from its own wallet. */
  delivery: number
  /** What Oja funds of the discounts on what the buyer kept (#6): the shop is paid it on top. */
  oja_discount: number
  commission: number
  /** What the shop is owed for the order. */
  amount: number
}

/**
 * What the shop is owed for an order: what the buyer kept (the order's own captures, less its
 * refunds of items and what it still owes the buyer), less the delivery fee, plus the discounts
 * Oja funds on it (`ojaFundedDiscount`), less 10% of that. A shop's own discounts stay off its
 * payout. Paystack's fees are Oja's.
 *
 * An order edit (#22, #32) doesn't change what was captured: the lines it removed are owed to
 * the buyer until refunded, then refunded. Either way they come off once, so the shop is never
 * paid for them, whether their refund failed or never ran. A refund of delivery (#22) comes out
 * of the delivery fee Oja keeps, so it never lowers the payout.
 */
export function payoutOf({
  transactions,
  refunds = [],
  owedToBuyer = 0,
  delivery,
  ojaDiscount,
}: {
  transactions: OrderTransaction[]
  /** The order's refunds (`order_refund`): what each of Medusa's refunds of it covers. */
  refunds?: Pick<OrderRefundRecord, "refund_id" | "covers">[]
  /** What the order owes its buyer and hasn't refunded (`owedToBuyerOf`). */
  owedToBuyer?: number
  delivery: number
  ojaDiscount: number
}): OrderPayout {
  const covers = new Map(refunds.flatMap((r) => (r.refund_id ? [[r.refund_id, r.covers] as const] : [])))
  const sum = (counted: (t: OrderTransaction) => boolean) =>
    transactions.filter(counted).reduce((total, t) => total + toSubunit(Number(t.amount)), 0)
  const paid = sum((t) => t.reference === "capture")
  // Refund transactions are negative.
  const ofItems = Math.abs(sum((t) => t.reference === "refund" && covers.get(t.reference_id ?? "") !== "delivery"))
  const refunded = ofItems + toSubunit(owedToBuyer)
  const goods = Math.max(0, paid - refunded - toSubunit(delivery)) + toSubunit(ojaDiscount)
  const commission = Math.round((goods * COMMISSION_PERCENT) / 100)
  return {
    paid: fromSubunit(paid),
    refunded: fromSubunit(refunded),
    delivery,
    oja_discount: ojaDiscount,
    commission: fromSubunit(commission),
    amount: fromSubunit(goods - commission),
  }
}

/** An order already paid out: what it was paid, what that payout took back for earlier orders, and what it is owed now. */
export type PaidOutOrder = { amount: number; recovered: number; owed: number }

/**
 * What a shop owes back: what its orders were paid beyond what they are now owed (refunds made
 * after the payout), less what its later payouts already took back. Below zero when a refund
 * taken back later failed, which the next payout gives back.
 */
export function owedBack(orders: PaidOutOrder[]): number {
  const subunits = orders.reduce(
    (total, o) => total + toSubunit(o.amount) - toSubunit(o.owed) - toSubunit(o.recovered),
    0
  )
  return fromSubunit(subunits)
}

/** Takes what the shop owes back out of an order's payout, at most all of it. */
export function recover(amount: number, owed: number): { recovered: number; transfer: number } {
  const recovered = Math.min(toSubunit(amount), toSubunit(owed))
  return { recovered: fromSubunit(recovered), transfer: fromSubunit(toSubunit(amount) - recovered) }
}

export type Scope = Pick<MedusaContainer, "resolve">

/** An attempt at paying an order out, and its payout's status: null when none was recorded. */
export type PayoutAttempt = { row: ShopPayoutRow; status: PayoutStatus | null }

/** Each order's attempts at a payout, first to last; an order not listed has none. */
export async function payoutAttemptsOf(scope: Scope, orderIds: string[]): Promise<Map<string, PayoutAttempt[]>> {
  if (!orderIds.length) return new Map()
  const rows = (await fulfilmentService(scope).listShopPayouts({ order_id: orderIds }, { order: { attempt: "ASC" } })).map(
    asPayoutRow
  )
  const statuses = await payoutStatuses(scope, rows.flatMap((r) => (r.payout_id ? [r.payout_id] : [])))
  const attempts = new Map<string, PayoutAttempt[]>()
  for (const row of rows) {
    const status = (row.payout_id && statuses.get(row.payout_id)) || null
    attempts.set(row.order_id, [...(attempts.get(row.order_id) ?? []), { row, status }])
  }
  return attempts
}

/** How many times an order is tried before its payout is left to an operator. */
export const MAX_PAYOUT_ATTEMPTS = 3

/**
 * The next attempt at paying an order out, given its earlier attempts' payout statuses (null for
 * a transfer Paystack took whose payout wasn't recorded). None while one is on its way or paid,
 * or once every attempt has failed.
 */
export function nextPayoutAttempt(attempts: (PayoutStatus | null)[]): number | null {
  if (attempts.some((status) => !status || !UNPAID.has(status))) return null
  return attempts.length < MAX_PAYOUT_ATTEMPTS ? attempts.length + 1 : null
}

/** An order's payout as `payOutOrderWorkflow` makes it. */
export type PayoutToMake = {
  order_id: string
  seller_id: string
  /** The shop's payout account with Mercur. */
  account_id: string
  currency_code: string
  breakdown: OrderPayout
  recovered: number
  /** What is sent: the order's payout less what was recovered. */
  transfer: number
  recipient_code: string
  /** The order's first attempt at a payout, or a later one after transfers failed. */
  attempt: number
  /** Paystack's reference for the transfer, one per attempt. */
  reference: string
  reason: string
}

type PaidOrder = {
  id: string
  display_id: number
  currency_code: string
  status: string
  shipping_total: number
  transactions?: OrderTransaction[] | null
  seller?: { id: string; payout_account?: { id: string } | null } | null
  /** What Oja funds of the discounts on what the buyer kept (`ojaFundedDiscount`). */
  oja_discount: number
  /** The order's refunds, each of its items or of its delivery fee, which Oja bears (#22). */
  refunds: OrderRefundRecord[]
  /** What the order owes its buyer and hasn't refunded: lines an order edit removed (#22, #32). */
  owed_to_buyer: number
}

type PaidOrderRow = Omit<PaidOrder, "oja_discount" | "refunds" | "owed_to_buyer"> & {
  summary?: OrderSummary
  items?:
    | {
        id: string
        quantity: number
        tax_lines?: { rate: number }[] | null
        adjustments?: { amount: number; is_tax_inclusive: boolean | null; promotion_id: string | null }[] | null
      }[]
    | null
}

/** Paystack's reference for an attempt at an order's transfer: lowercase letters, digits, `-` and `_`. */
function transferReference(orderId: string, attempt: number) {
  const retry = attempt > 1 ? `_${attempt}` : ""
  return `payout_${orderId}${retry}`.toLowerCase()
}

async function paidOrders(scope: Scope, orderIds: string[]): Promise<PaidOrder[]> {
  if (!orderIds.length) return []
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "currency_code",
      "status",
      "shipping_total",
      "summary",
      "transactions.amount",
      "transactions.reference",
      "transactions.reference_id",
      "seller.id",
      "seller.payout_account.id",
      "items.id",
      "items.quantity",
      "items.tax_lines.rate",
      "items.adjustments.amount",
      "items.adjustments.is_tax_inclusive",
      "items.adjustments.promotion_id",
    ],
    filters: { id: orderIds },
  })
  const orders = data as unknown as PaidOrderRow[]
  const [records, shares, refunds] = await Promise.all([
    fulfilmentsOf(scope, orderIds),
    ojaSharesOf(scope, orderIds),
    fulfilmentService(scope).listOrderRefunds({ order_id: orderIds }),
  ])
  return orders.map(({ items, summary, ...order }) => {
    const record = records.get(order.id)
    const removed = record?.removed ?? {}
    const ofOrder = refunds.filter((r) => r.order_id === order.id)
    // The buyer of a rejected or cancelled order keeps none of its lines, and is owed whatever
    // of its share isn't refunded yet, so the shop is paid nothing for it.
    const givenBack = givesShareBack(record)
    const lines = (items ?? []).map((i) => ({
      quantity: Number(i.quantity),
      removed: givenBack ? Number(i.quantity) : (removed[i.id] ?? 0),
      tax_rate: taxRateOf(i.tax_lines),
      adjustments: (i.adjustments ?? []).map((a) => ({
        amount: Number(a.amount),
        is_tax_inclusive: a.is_tax_inclusive,
        promotion_id: a.promotion_id,
      })),
    }))
    return {
      ...order,
      oja_discount: ojaFundedDiscount(lines, shares.get(order.id) ?? new Map()),
      refunds: ofOrder,
      owed_to_buyer: givenBack ? shareLeft({ transactions: transactionsOf(order), refunds: ofOrder }) : owedToBuyerOf(summary),
    }
  })
}

const breakdownOf = (order: PaidOrder, delivery = Number(order.shipping_total ?? 0)) =>
  payoutOf({
    transactions: order.transactions ?? [],
    refunds: order.refunds,
    owedToBuyer: order.owed_to_buyer,
    delivery,
    ojaDiscount: order.oja_discount,
  })

/**
 * Orders with a refund of items Paystack hasn't settled, which wait for it before they are paid
 * out. A refund of delivery doesn't change the payout (#22), so it holds nothing up, and nor
 * does one handed to Oja's team to send by hand (#13): it counts as refunded already.
 */
export async function withUnsettledRefunds(scope: Scope, orderIds: string[]): Promise<Set<string>> {
  if (!orderIds.length) return new Set()
  const rows = await fulfilmentService(scope).listOrderRefunds({
    order_id: orderIds,
    covers: "items",
    status: UNSETTLED_REFUND_STATUSES,
    handed_over_at: null,
  })
  return new Set(rows.map((r) => r.order_id!))
}

/**
 * The payout to make for a delivered order, taking out what the shop owes back. Refused for an
 * order not delivered, cancelled, already paid out, or with a refund Paystack hasn't settled,
 * and for a shop without a bank account or payout account.
 */
export async function payoutToMake(scope: Scope, orderId: string, owed: number): Promise<PayoutToMake> {
  const refuse = (why: string) => new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${orderId} can't be paid out: ${why}`)
  const [order] = await paidOrders(scope, [orderId])
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} was not found`)
  if (order.status === "canceled") throw refuse("it was cancelled")
  if (!(await fulfilmentsOf(scope, [orderId])).get(orderId)?.payout_eligible_at) throw refuse("it isn't delivered")
  const attempts = (await payoutAttemptsOf(scope, [orderId])).get(orderId) ?? []
  const attempt = nextPayoutAttempt(attempts.map((a) => a.status))
  if (!attempt) {
    throw refuse(attempts.length >= MAX_PAYOUT_ATTEMPTS ? "every attempt failed" : "it was paid out already")
  }
  if ((await withUnsettledRefunds(scope, [orderId])).size) throw refuse("a refund of it hasn't settled")
  const sellerId = order.seller?.id
  const accountId = order.seller?.payout_account?.id
  if (!sellerId || !accountId) throw refuse("its shop has no payout account")
  const [bank] = await scope
    .resolve<ShopBankAccountModuleService>(SHOP_BANK_ACCOUNT_MODULE)
    .listShopBankAccounts({ seller_id: sellerId }, { take: 1 })
  if (!bank) throw refuse("its shop has no bank account")
  const breakdown = breakdownOf(order)
  const { recovered, transfer } = recover(breakdown.amount, owed)
  return {
    order_id: order.id,
    seller_id: sellerId,
    account_id: accountId,
    currency_code: order.currency_code,
    breakdown,
    recovered,
    transfer,
    recipient_code: bank.recipient_code,
    attempt,
    reference: transferReference(order.id, attempt),
    reason: `${PRODUCT_NAME} order #${order.display_id}`,
  }
}

type ShopPayoutRow = {
  id: string
  order_id: string
  seller_id: string
  payout_id: string | null
  currency_code: string
  paid: number
  refunded: number
  delivery: number
  oja_discount: number
  commission: number
  amount: number
  recovered: number
  attempt: number
  transfer_reference: string
  created_at: Date
}

const asPayoutRow = (row: Record<string, unknown>): ShopPayoutRow => {
  const r = row as unknown as ShopPayoutRow
  const money = ["paid", "refunded", "delivery", "oja_discount", "commission", "amount", "recovered"] as const
  return { ...r, ...Object.fromEntries(money.map((k) => [k, Number(r[k])])) }
}

/** Mercur's payouts' statuses, by payout id. */
async function payoutStatuses(scope: Scope, payoutIds: string[]): Promise<Map<string, PayoutStatus>> {
  if (!payoutIds.length) return new Map()
  const { data } = await scope
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "payout", fields: ["id", "status"], filters: { id: payoutIds } })
  return new Map((data as { id: string; status: PayoutStatus }[]).map((p) => [p.id, p.status]))
}

/** A payout whose money never reached the shop: it neither paid an order nor took anything back. */
const UNPAID = new Set([PayoutStatus.FAILED, PayoutStatus.CANCELED])

/**
 * What the shop owes back for refunds made after its orders were paid out, less what its later
 * payouts took back already. Only an order refunded at some point can be owed less than it was
 * paid, so only those are worked out again.
 */
export async function owedBackBy(scope: Scope, sellerId: string): Promise<number> {
  const rows = (await fulfilmentService(scope).listShopPayouts({ seller_id: sellerId })).map(asPayoutRow)
  const statuses = await payoutStatuses(scope, rows.flatMap((r) => (r.payout_id ? [r.payout_id] : [])))
  const counted = rows.filter((r) => {
    const status = r.payout_id ? statuses.get(r.payout_id) : undefined
    return !!status && !UNPAID.has(status)
  })
  const ids = counted.map((r) => r.order_id)
  const refunded = new Set(
    ids.length ? (await fulfilmentService(scope).listOrderRefunds({ order_id: ids })).map((r) => r.order_id!) : []
  )
  const orders = new Map((await paidOrders(scope, [...refunded])).map((o) => [o.id, o]))
  return owedBack(
    counted.map((r) => {
      const order = orders.get(r.order_id)
      return { amount: r.amount, recovered: r.recovered, owed: order ? breakdownOf(order, r.delivery).amount : r.amount }
    })
  )
}

/** The webhook action that moves a payout to a settled transfer's status. */
const SETTLED: Partial<Record<PayoutStatus, PayoutWebhookAction>> = {
  [PayoutStatus.PAID]: "payout.paid",
  [PayoutStatus.FAILED]: "payout.failed",
}

/**
 * Brings an order's payout up to date with its Paystack transfer, on a `transfer.*` webhook.
 * The webhook is only a cue: Paystack's API is asked for the transfer's status. A transfer that
 * isn't an order's payout, or that Paystack hasn't settled, changes nothing.
 */
export async function syncPayoutTransfer(scope: MedusaContainer, reference: string) {
  const [row] = await fulfilmentService(scope).listShopPayouts({ transfer_reference: reference }, { take: 1 })
  const paystack = paystackClient()
  if (!row || !paystack) return
  // Paystack answered the transfer before the payout was noted on the order: the event is retried.
  if (!row.payout_id) throw new Error(`Order ${row.order_id}'s payout isn't recorded yet`)
  const action = SETTLED[payoutStatusOf((await paystack.verifyTransfer(reference)).status)]
  if (!action) return
  await processPayoutForWebhookWorkflow(scope).run({ input: { action, data: { id: row.payout_id } } })
  if (action === "payout.failed" && Number(row.attempt) >= MAX_PAYOUT_ATTEMPTS) await alertPayoutGaveUp(scope, row.order_id)
}

/** Tells the admin an order's payout failed every attempt: an operator has to pay the shop. */
async function alertPayoutGaveUp(scope: MedusaContainer, orderId: string) {
  const description = `Order ${orderId}'s payout failed ${MAX_PAYOUT_ATTEMPTS} times and won't be tried again. Check the shop's bank account and pay it by hand.`
  scope.resolve(ContainerRegistrationKeys.LOGGER).warn(description)
  await scope.resolve(Modules.NOTIFICATION).createNotifications({
    to: "",
    channel: "feed",
    template: "admin-ui",
    data: { title: "Payout failed", description },
    idempotency_key: `payout-gave-up:${orderId}`,
  })
}

/** Where an order's payout is, as staff see it. */
export type PayoutState =
  /** Not delivered (or collected) yet. */
  | "not_due"
  /** Delivered, waiting for a refund Paystack hasn't settled. */
  | "waiting_for_refund"
  /** Delivered; paid out on the next daily run. */
  | "due"
  /** Its transfer failed; tried again on the next daily run. */
  | "retrying"
  | `${PayoutStatus}`

export type OrderPayoutView = OrderPayout & {
  state: PayoutState
  currency_code: string
  commission_percent: number
  /** What the payout took back for refunds after the shop's earlier payouts; null until paid out. */
  recovered: number | null
  /** What was sent to the shop's bank; null until paid out. */
  transferred: number | null
  paid_out_at: string | null
}

/**
 * What staff see of an order's payout: what it is (or will be) and where it is. Once paid out,
 * the amounts are those it was paid out with.
 */
export async function orderPayoutView(scope: Scope, orderId: string): Promise<OrderPayoutView> {
  const [order] = await paidOrders(scope, [orderId])
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} was not found`)
  const attempts = (await payoutAttemptsOf(scope, [orderId])).get(orderId) ?? []
  const base = { currency_code: order.currency_code, commission_percent: COMMISSION_PERCENT }
  const latest = attempts.at(-1)
  if (latest) {
    const { row, status } = latest
    const retrying = order.status !== "canceled" && nextPayoutAttempt(attempts.map((a) => a.status)) !== null
    return {
      ...base,
      paid: row.paid,
      refunded: row.refunded,
      delivery: row.delivery,
      oja_discount: row.oja_discount,
      commission: row.commission,
      amount: row.amount,
      state: retrying ? "retrying" : (status ?? PayoutStatus.PENDING),
      recovered: row.recovered,
      transferred: recover(row.amount, row.recovered).transfer,
      paid_out_at: new Date(row.created_at).toISOString(),
    }
  }
  const eligible = !!(await fulfilmentsOf(scope, [orderId])).get(orderId)?.payout_eligible_at
  const waiting = eligible && (await withUnsettledRefunds(scope, [orderId])).size > 0
  let state: PayoutState = waiting ? "waiting_for_refund" : "due"
  if (!eligible || order.status === "canceled") state = "not_due"
  return { ...base, ...breakdownOf(order), state, recovered: null, transferred: null, paid_out_at: null }
}
