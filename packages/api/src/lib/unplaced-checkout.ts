import type { ILockingModule, IWorkflowEngineService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, TransactionState } from "@medusajs/framework/utils"
import { completeCartWithSplitOrdersWorkflow } from "@mercurjs/core/workflows"
import type { NotPlaced, NotPlacedChange } from "@oja/domain"
import { refundUnclaimedPaymentWorkflow } from "../workflows/order-fulfilment/workflows/refund-unclaimed-payment"
import { tellCartNotPlaced } from "./buyer-notifications"
import { errorMessage } from "./errors"
import { notPlacedReason } from "./not-placed-reason"
import type { OrderRefundRecord } from "./order-fulfilment"
import { deleteCartSessions, fixUnplacedCart } from "./unplaced-cart"

// A paid cart that fails to become orders (#38, ADR 0003). Mercur's payment webhook captures the
// payment, then completes the cart, and swallows a completion that fails: the money is taken and
// nothing is placed. Once Mercur's handling of the webhook has finished, the cart is checked; if
// it isn't orders, completion is tried once more. If that fails too, the payment is refunded in
// full, the cart fixed (the used-up code, sold-out lines, gone offers and deliveries taken off),
// and the buyer told why.

type Scope = Pick<MedusaContainer, "resolve">

/** A cart that wasn't placed, as checkout keeps it on the cart's metadata. */
export type StoredNotPlaced = NotPlaced & {
  currency_code: string
  changes: NotPlacedChange[]
  refund_id: string
  /** The error the cart's last completion failed with; null when none was tried. */
  failure: string | null
}

/** The cart metadata key a cart that wasn't placed is kept under. */
export const NOT_PLACED_KEY = "not_placed"

/**
 * How long Mercur's capture may take to show before the payment counts as not captured: its
 * handling of the webhook waits up to 30 seconds for the cart's lock, then captures at once.
 */
const CAPTURE_WAIT_MS = 35_000
/**
 * How long Mercur's handling of the webhook may take to finish completing the cart, before the
 * cart is left to the job for payments no order claims: the 2 minutes Mercur holds the cart's
 * lock for.
 */
const COMPLETION_WAIT_MS = 120_000
/** How long the cart's lock is waited for, to refund it. */
const CART_LOCK_TIMEOUT_S = 30

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls `check` every quarter second until it is truthy or `ms` have passed; returns its last value. */
async function waitFor<T>(check: () => Promise<T>, ms: number): Promise<T> {
  let value = await check()
  for (const started = Date.now(); !value && Date.now() - started < ms; ) {
    await sleep(250)
    value = await check()
  }
  return value
}

type PaidSession = { payment_id: string; cart_id: string }

/** The captured payment of a payment session, and its cart; null while it isn't captured. */
async function capturedPayment(scope: Scope, sessionId: string): Promise<PaidSession | null> {
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "payment",
    fields: ["id", "captured_at", "payment_collection_id"],
    filters: { payment_session_id: sessionId },
  })
  const payment = data[0] as { id: string; captured_at: Date | string | null; payment_collection_id: string } | undefined
  if (!payment?.captured_at) return null
  const cartId = await cartOfCollection(scope, payment.payment_collection_id)
  return cartId ? { payment_id: payment.id, cart_id: cartId } : null
}

async function cartOfCollection(scope: Scope, collectionId: string): Promise<string | null> {
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "cart_payment_collection",
    fields: ["cart_id"],
    filters: { payment_collection_id: collectionId },
  })
  return (data[0] as { cart_id: string } | undefined)?.cart_id ?? null
}

async function cartOfPayment(scope: Scope, paymentId: string): Promise<string | null> {
  const { data } = await scope
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "payment", fields: ["payment_collection_id"], filters: { id: paymentId } })
  const collectionId = (data[0] as { payment_collection_id?: string } | undefined)?.payment_collection_id
  return collectionId ? cartOfCollection(scope, collectionId) : null
}

async function isPlaced(scope: Scope, cartId: string) {
  // Completing the cart marks it completed along with creating its orders, or undoes both.
  const cart = await scope.resolve(Modules.CART).retrieveCart(cartId, { select: ["id", "completed_at"] })
  return !!cart.completed_at
}

const FINISHED: string[] = [TransactionState.DONE, TransactionState.REVERTED, TransactionState.FAILED]

type CompletionContext = { data?: { payload?: { cart_id?: string } } }

/**
 * The cart's completions (`completeCartWithSplitOrdersWorkflow`, Mercur's or ours), whether each
 * has finished, started since `since` when given. Mercur stores the workflow's executions:
 * Medusa's workflow engine keeps each from before its first step, and for 3 days once finished.
 */
async function completionsOf(scope: Scope, cartId: string, since?: Date): Promise<{ finished: boolean }[]> {
  const runs = await scope.resolve<IWorkflowEngineService>(Modules.WORKFLOW_ENGINE).listWorkflowExecutions(
    {
      workflow_id: completeCartWithSplitOrdersWorkflow.getName(),
      ...(since ? { created_at: { $gte: since.toISOString() } } : { state: { $nin: FINISHED } }),
    },
    { select: ["state", "context"] }
  )
  return runs
    .filter((r) => (r.context as CompletionContext | undefined)?.data?.payload?.cart_id === cartId)
    .map((r) => ({ finished: FINISHED.includes(r.state) }))
}

/** Whether a completion of the cart is still running. */
async function completing(scope: Scope, cartId: string): Promise<boolean> {
  return (await completionsOf(scope, cartId)).some((r) => !r.finished)
}

/**
 * Whether Mercur's handling of a payment webhook for the session has finished with the cart: no
 * completion of it is running, and one started since the session did or it became orders.
 * Mercur completes the cart once it has captured the payment, without the cart's lock, so this
 * is what there is to wait for. A completion marks the cart completed before it has reserved its
 * stock, and undoes that when it can't, so the cart only counts as orders once none is running.
 */
async function completedOrTried(scope: Scope, cartId: string, sessionStarted: Date): Promise<boolean> {
  const runs = await completionsOf(scope, cartId, sessionStarted)
  if (runs.some((r) => !r.finished)) return false
  return runs.length > 0 || (await isPlaced(scope, cartId))
}

async function sessionStartedAt(scope: Scope, sessionId: string): Promise<Date> {
  const { data } = await scope
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "payment_session", fields: ["created_at"], filters: { id: sessionId } })
  return new Date((data[0] as { created_at: Date | string }).created_at)
}

/**
 * After Mercur's handling of a successful payment for a live session: once the payment is
 * captured and Mercur has finished completing the cart, checks that the cart became orders. If
 * it didn't, tries completion once more (under the cart's lock), and if that fails too, refunds
 * it. This waits as long as Mercur's own handling of the webhook takes.
 */
export async function placeOrRefundPaidSession(scope: Scope, sessionId: string) {
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const paid = await waitFor(() => capturedPayment(scope, sessionId), CAPTURE_WAIT_MS)
  // Nothing captured, nothing to refund: the money is in no Medusa payment (ADR 0003).
  if (!paid) return logger.warn(`Payment session ${sessionId} was paid but never captured`)

  const started = await sessionStartedAt(scope, sessionId)
  const finished = await waitFor(() => completedOrTried(scope, paid.cart_id, started), COMPLETION_WAIT_MS)
  if (!finished) {
    return logger.warn(`Cart ${paid.cart_id} is still being completed; if it isn't placed, the job for payments no order claims refunds it`)
  }
  if (await isPlaced(scope, paid.cart_id)) return
  let failure: string | null = null
  try {
    await completeCartWithSplitOrdersWorkflow(scope as MedusaContainer).run({ input: { cart_id: paid.cart_id } })
    if (await isPlaced(scope, paid.cart_id)) return
  } catch (error) {
    failure = errorMessage(error)
    logger.warn(`Cart ${paid.cart_id} was paid but failed to become orders twice: ${failure}`)
  }
  await refundUnplacedPayment(scope, paid.payment_id, failure)
}

/**
 * Refunds in full a captured payment no order claims, then fixes its cart and keeps why it
 * wasn't placed (`failure`, the error its last completion failed with, when one was tried). The
 * accept-deadline job's backstop comes here too.
 *
 * The refund is made holding the cart's lock, which Mercur's handling of a payment webhook takes
 * before it captures, and only once the cart isn't orders and Mercur isn't completing it; and
 * under the lock every refund of the payment takes, so it is refunded once however it is asked.
 * The cart's payment sessions are deleted before the lock is let go, so nothing completes it on
 * the refunded payment (Paystack sending the webhook again).
 */
export async function refundUnplacedPayment(scope: Scope, paymentId: string, failure: string | null = null) {
  const cartId = await cartOfPayment(scope, paymentId)
  if (!cartId) {
    await refundUnclaimedPaymentWorkflow(scope as MedusaContainer).run({ input: { payment_id: paymentId } })
    return
  }
  const refund = await scope.resolve<ILockingModule>(Modules.LOCKING).execute(
    cartId,
    async () => {
      if ((await isPlaced(scope, cartId)) || (await completing(scope, cartId))) return null
      const { result } = await refundUnclaimedPaymentWorkflow(scope as MedusaContainer).run({ input: { payment_id: paymentId } })
      if (result) await deleteCartSessions(scope, cartId)
      return result
    },
    { timeout: CART_LOCK_TIMEOUT_S }
  )
  if (refund) await recordNotPlaced(scope, cartId, refund, failure)
}

/** Fixes the cart, keeps why it wasn't placed on it for checkout to show, and tells the buyer. */
async function recordNotPlaced(scope: Scope, cartId: string, refund: OrderRefundRecord, failure: string | null) {
  const { changes, causes } = await fixUnplacedCart(scope, cartId)
  const notPlaced: StoredNotPlaced = {
    reason: notPlacedReason(failure, causes),
    amount: Number(refund.amount),
    currency_code: refund.currency_code,
    changes,
    refund_id: refund.id,
    failure,
  }
  const carts = scope.resolve(Modules.CART)
  const cart = await carts.retrieveCart(cartId, { select: ["id", "metadata", "customer_id", "email"] })
  await carts.updateCarts(cartId, { metadata: { ...cart.metadata, [NOT_PLACED_KEY]: notPlaced } })
  await tellCartNotPlaced(scope, { cart_id: cartId, customer_id: cart.customer_id ?? null, email: cart.email ?? null, not_placed: notPlaced })
}
