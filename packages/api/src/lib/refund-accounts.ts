import type { ILockingModule, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { PaystackRequestError, type PaystackRefundStatus } from "../modules/paystack/client"
import { askForRefundAccount } from "./buyer-notifications"
import { accountRefused, lookupsLimited, requirePaystack } from "./onboarding"
import { fulfilmentService, type OrderRefundRecord } from "./order-fulfilment"

// A refund Paystack couldn't return to the buyer's card needs their bank account (#13). The
// buyer is asked for one in the app, which Paystack resolves to its holder's name for them to
// confirm, and Paystack retries the refund to it. The account number goes to Paystack only:
// it is never stored, logged or reported, and the refund keeps the bank and last 4 digits.

type Scope = Pick<MedusaContainer, "resolve">

/** The lock every refund of the order takes (`refundLockKeys`), so a retry and a hand-over don't race. */
const refundLockKey = (orderId: string) => `order-refund:${orderId}`

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
  /** The account it was retried to: its bank and the account number's last 4 digits. */
  account: { bank_name: string; last4: string } | null
}

type OrderRow = { id: string; display_id: number; customer_id?: string | null; seller?: { name?: string | null } | null }

/** A refund that needs the buyer's account, and Oja's team hasn't taken over. */
export const needsAccount = (refund: Pick<OrderRefundRecord, "status" | "handed_over_at">) =>
  refund.status === "needs-attention" && !refund.handed_over_at

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
  if (!order || order.customer_id !== customerId) throw notFound
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
    account:
      refund.account_bank_name && refund.account_last4 ? { bank_name: refund.account_bank_name, last4: refund.account_last4 } : null,
  }
}

/** A bank a refund can be retried to: Paystack's code (to resolve accounts at) and id (to retry to). */
type RefundBank = { code: string; name: string; id: number }

/** Paystack's active banks in the currency, by name, each once. */
async function refundBanksFor(currencyCode: string): Promise<RefundBank[]> {
  const banks = await requirePaystack().listBanks(currencyCode.toUpperCase())
  const byCode = new Map(banks.filter((b) => b.active).map((b) => [b.code, { code: b.code, name: b.name, id: b.id }]))
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** What the buyer enters: the bank, from the list, and the account number at it. */
export type RefundAccountInput = { bank_code: string; account_number: string }

/** The buyer's refund that needs their account, and the bank they chose; refused otherwise. */
async function refundNeedingAccount(scope: Scope, customerId: string, refundId: string, bankCode: string) {
  const { refund, order } = await buyerRefundOf(scope, customerId, refundId)
  if (!needsAccount(refund)) {
    throw new MedusaError(MedusaError.Types.CONFLICT, refund.handed_over_at ? "Our team is sending this refund" : "This refund doesn't need a bank account")
  }
  const bank = (await refundBanksFor(refund.currency_code)).find((b) => b.code === bankCode)
  if (!bank) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose your bank from the list")
  return { refund, order, bank }
}

/** The banks the buyer can have their refund sent to. */
export async function refundBanks(scope: Scope, customerId: string, refundId: string): Promise<{ code: string; name: string }[]> {
  const { refund } = await buyerRefundOf(scope, customerId, refundId)
  return (await refundBanksFor(refund.currency_code)).map(({ code, name }) => ({ code, name }))
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
 * last 4 digits; the number itself goes to Paystack only.
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
    await fulfilmentService(scope).updateOrderRefunds({
      id: refund.id,
      status: retried.status,
      account_bank_name: bank.name,
      account_last4: input.account_number.slice(-4),
    })
  })
  return buyerRefundAccountView(scope, customerId, refundId)
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
  await scope.resolve(Modules.NOTIFICATION).createNotifications({
    to: "",
    channel: "feed",
    template: "admin-ui",
    data: { title: "Refund needs the buyer's bank account", description },
    idempotency_key: `refund-needs-attention:${refund.id}:${refund.needs_attention_at ? new Date(refund.needs_attention_at).toISOString() : ""}`,
  })
}
