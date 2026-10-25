import type { ILockingModule, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { PaystackRequestError, type PaystackRefundStatus } from "../modules/paystack/client"
import { notifyOjaTeam } from "./admin-notifications"
import { askForRefundAccount } from "./buyer-notifications"
import { refundLines, type RefundLine } from "./buyer-orders"
import { errorMessage } from "./errors"
import { accountRefused, activeBanks, lookupsLimited, requirePaystack } from "./paystack"
import { fulfilmentService, type OrderRefundRecord } from "./order-fulfilment"
import { needsAccount, needsAttentionSince } from "./owed-refunds"
import { handOverOwedRefundsOf } from "./refund-retry"

// A refund Paystack couldn't return to the buyer's card needs their bank account (#13). The
// buyer is asked for one in the app, which Paystack resolves to its holder's name for them to
// confirm, and Paystack retries the refund to it. The account number goes to Paystack only:
// it is never stored, logged or reported, and the refund keeps the bank and last 4 digits.

type Scope = Pick<MedusaContainer, "resolve">

/** The lock every refund of the order takes (`refundLockKeys`), so a retry and a hand-over don't race. */
const refundLockKey = (orderId: string) => `order-refund:${orderId}`

const DAY = 24 * 60 * 60 * 1000

/** The days after a refund first needs attention that the buyer is reminded, then handed to Oja's team. */
export const REFUND_ACCOUNT_REMINDER_DAYS = [1, 3]
export const REFUND_ACCOUNT_HAND_OVER_DAYS = 7

/** What follows up a refund still waiting for the buyer's account: a reminder, or handing it to Oja's team. */
export type RefundAccountFollowUp = { reminder: { nth: number; days_left: number } } | "hand_over"

/**
 * What is due `now` for a refund that has needed the buyer's bank account since `since`: the
 * latest reminder reached (1 or 3 days on), then after 7 days the hand-over to Oja's team;
 * nothing during the first day.
 */
export function refundAccountFollowUp(since: Date, now: Date): RefundAccountFollowUp | null {
  const days = (now.getTime() - since.getTime()) / DAY
  if (days >= REFUND_ACCOUNT_HAND_OVER_DAYS) return "hand_over"
  const nth = REFUND_ACCOUNT_REMINDER_DAYS.filter((d) => days >= d).length
  if (!nth) return null
  return { reminder: { nth, days_left: REFUND_ACCOUNT_HAND_OVER_DAYS - REFUND_ACCOUNT_REMINDER_DAYS[nth - 1]! } }
}

/** A refund of one of the buyer's orders, as the app's refund screen shows it. */
export type BuyerRefundAccount = {
  id: string
  amount: number
  currency_code: string
  status: PaystackRefundStatus
  /** Whether the buyer can add a bank account for it now: it needs attention, and Oja's team hasn't taken it over. */
  needs_account: boolean
  /** Whether Oja's team took it over, the buyer having given no account in 7 days. */
  handed_over: boolean
  order: { id: string; display_id: number; shop: string; order_group_id: string | null }
  /** The order lines it was for, with how many units of each (#95); null for a refund of no lines (of delivery alone). */
  lines: RefundLine[] | null
  /** The account it was retried to: its bank and the account number's last 4 digits. */
  account: { bank_name: string; last4: string } | null
}

type OrderRow = { id: string; display_id: number; customer_id?: string | null; seller?: { name?: string | null } | null }


/** The buyer's refund and its order; not found when it isn't a refund of one of their orders. */
export async function buyerRefundOf(scope: Scope, customerId: string, refundId: string): Promise<{ refund: OrderRefundRecord; order: OrderRow }> {
  const notFound = new MedusaError(MedusaError.Types.NOT_FOUND, `Refund ${refundId} was not found`)
  const [refund] = await fulfilmentService(scope).listOrderRefunds({ id: refundId })
  if (!refund?.order_id) throw notFound
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order",
    fields: ["id", "display_id", "customer_id", "seller.name"],
    filters: { id: refund.order_id },
  })
  const order = data[0] as unknown as OrderRow | undefined
  if (order?.customer_id !== customerId) throw notFound
  return { refund, order }
}

/** The buyer's refund as the app shows it (`BuyerRefundAccount`). */
export async function buyerRefundAccountView(scope: Scope, customerId: string, refundId: string): Promise<BuyerRefundAccount> {
  const { refund, order } = await buyerRefundOf(scope, customerId, refundId)
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order_group_order",
    fields: ["order_group_id"],
    filters: { order_id: order.id },
  })
  return {
    id: refund.id,
    amount: Number(refund.amount),
    currency_code: refund.currency_code,
    status: refund.status,
    needs_account: needsAccount(refund),
    handed_over: !!refund.handed_over_at,
    order: {
      id: order.id,
      display_id: order.display_id,
      shop: order.seller?.name ?? "",
      order_group_id: (data[0] as unknown as { order_group_id?: string } | undefined)?.order_group_id ?? null,
    },
    lines: refundLines(refund.lines),
    account:
      refund.account_bank_name && refund.account_last4 ? { bank_name: refund.account_bank_name, last4: refund.account_last4 } : null,
  }
}

/** What the buyer enters: the bank, from the list, and the account number at it. */
export type RefundAccountInput = { bank_code: string; account_number: string }

/** The buyer's refund that needs their account, and the bank they chose; refused otherwise. */
async function refundNeedingAccount(scope: Scope, customerId: string, refundId: string, bankCode: string) {
  const { refund, order } = await buyerRefundOf(scope, customerId, refundId)
  if (!needsAccount(refund)) {
    throw new MedusaError(MedusaError.Types.CONFLICT, refund.handed_over_at ? "Our team is sending this refund" : "This refund doesn't need a bank account")
  }
  const bank = (await activeBanks(refund.currency_code)).find((b) => b.code === bankCode)
  if (!bank) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose your bank from the list")
  return { refund, order, bank }
}

/** The banks the buyer can have their refund sent to. */
export async function refundBanks(scope: Scope, customerId: string, refundId: string): Promise<{ code: string; name: string }[]> {
  const { refund } = await buyerRefundOf(scope, customerId, refundId)
  return (await activeBanks(refund.currency_code)).map(({ code, name }) => ({ code, name }))
}

/** A Paystack error as the buyer is told it, never repeating the account number they entered. */
function accountError(error: unknown, bankName: string): unknown {
  if (lookupsLimited(error)) {
    return new MedusaError(MedusaError.Types.NOT_ALLOWED, "Paystack can't check bank accounts right now. Try again later.")
  }
  if (!accountRefused(error)) return error
  return new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `We couldn't find that account at ${bankName}. Check the account number and the bank.`
  )
}

/**
 * The holder's name of the account the buyer entered, as Paystack resolves it, for them to
 * confirm before the refund is retried to it. Anyone's account will do: the name isn't matched.
 */
export async function resolveRefundAccount(
  scope: Scope,
  customerId: string,
  refundId: string,
  input: RefundAccountInput
): Promise<{ bank_name: string; account_name: string }> {
  const { bank } = await refundNeedingAccount(scope, customerId, refundId, input.bank_code)
  try {
    const { account_name } = await requirePaystack().resolveAccount({ account_number: input.account_number, bank_code: bank.code })
    return { bank_name: bank.name, account_name }
  } catch (error) {
    throw accountError(error, bank.name)
  }
}

/**
 * Retries the buyer's refund to the bank account they confirmed (#13), holding the order's
 * refund lock so Oja's team can't take it over meanwhile. Paystack queues it again, and its
 * `refund.*` webhooks carry on from there. The refund keeps the bank and the account number's
 * last 4 digits; the number itself goes to Paystack only. No longer waiting on the buyer, the
 * order may move to the past (#59).
 */
export async function retryRefundToAccount(
  scope: Scope,
  customerId: string,
  refundId: string,
  input: RefundAccountInput
): Promise<BuyerRefundAccount> {
  const { refund: found } = await buyerRefundOf(scope, customerId, refundId)
  await scope.resolve<ILockingModule>(Modules.LOCKING).execute(refundLockKey(found.order_id!), async () => {
    const { refund, bank } = await refundNeedingAccount(scope, customerId, refundId, input.bank_code)
    if (!refund.paystack_refund_id) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Refund ${refund.id} has no Paystack refund to retry`)
    let retried
    try {
      retried = await requirePaystack().retryRefund(refund.paystack_refund_id, {
        currency: refund.currency_code.toUpperCase(),
        account_number: input.account_number,
        bank_id: bank.id,
      })
    } catch (error) {
      scope
        .resolve(ContainerRegistrationKeys.LOGGER)
        .warn(`Paystack refused retrying refund ${refund.id} to the buyer's account at ${bank.name} (${error instanceof PaystackRequestError ? error.status : "no status"})`)
      throw accountError(error, bank.name)
    }
    await fulfilmentService(scope).changeRefunds([
      {
        id: refund.id,
        status: retried.status,
        account_bank_name: bank.name,
        account_last4: input.account_number.slice(-4),
      },
    ])
  })
  return buyerRefundAccountView(scope, customerId, refundId)
}

/**
 * Hands a refund the buyer gave no bank account for to Oja's team (#13), under the order's
 * refund lock so a retry the buyer sends meanwhile wins. It joins what the order owes its buyer
 * by hand (#16's Owed refunds): the admin is notified and the buyer told the team is sending it.
 * No longer waiting on the buyer, the order may move to the past (#59).
 */
async function handOverUnanswered(scope: Scope, refundId: string, orderId: string, now: Date): Promise<void> {
  await scope.resolve<ILockingModule>(Modules.LOCKING).execute(refundLockKey(orderId), async () => {
    const [refund] = await fulfilmentService(scope).listOrderRefunds({ id: refundId })
    if (!refund || !needsAccount(refund)) return
    await fulfilmentService(scope).changeRefunds([{ id: refundId, handed_over_at: now }])
  })
  await handOverOwedRefundsOf(scope, [orderId])
}

/**
 * The follow-up job (#13): reminds the buyer of each refund still waiting for their bank
 * account after 1 and 3 days, by push and email, once each, and after 7 days hands it to Oja's
 * team. A refund that can't be followed up is logged, and the others still are.
 */
export async function followUpRefundAccounts(scope: Scope, now = new Date()): Promise<void> {
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const waiting = await fulfilmentService(scope).listOrderRefunds({
    status: "needs-attention",
    handed_over_at: null,
    order_id: { $ne: null },
    needs_attention_at: { $ne: null },
  })
  // One at a time, on purpose: handing over takes the order's refund lock and checks the admin's
  // notices before adding one, so two refunds of one order followed up at once would race.
  for (const refund of waiting) {
    const due = refundAccountFollowUp(new Date(refund.needs_attention_at!), now)
    try {
      if (due === "hand_over") await handOverUnanswered(scope, refund.id, refund.order_id!, now)
      else if (due) await askForRefundAccount(scope, refund.id, due.reminder)
    } catch (error) {
      logger.warn(`Following up refund ${refund.id}, which needs the buyer's bank account, failed: ${errorMessage(error)}`)
    }
  }
}

/**
 * Paystack says a refund needs attention: the buyer of its order is asked for a bank account.
 * A refund of no order (a payment no order claims) has no buyer to ask in the app, so Oja's
 * team is told to retry it from Paystack's dashboard.
 */
export async function refundNeedsAttention(scope: Scope, refundId: string): Promise<void> {
  const [refund] = await fulfilmentService(scope).listOrderRefunds({ id: refundId })
  if (!refund || !needsAccount(refund)) return
  if (refund.order_id) {
    await askForRefundAccount(scope, refund.id)
    return
  }
  const description = `Paystack refund ${refund.paystack_refund_id} (${refund.currency_code.toUpperCase()} ${Number(refund.amount)}, transaction ${refund.transaction_reference}) needs the buyer's bank account, and refunds no order to ask its buyer through. Retry it from Paystack's dashboard.`
  scope.resolve(ContainerRegistrationKeys.LOGGER).warn(description)
  await notifyOjaTeam(scope, {
    title: "Refund needs the buyer's bank account",
    description,
    key: `refund-needs-attention:${refund.id}:${needsAttentionSince(refund)}`,
  })
}
