import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { completeCartWithSplitOrdersWorkflow } from "@mercurjs/core/workflows"
import type { NotPlaced, NotPlacedChange, NotPlacedReason } from "@oja/domain"
import { refundUnclaimedPaymentWorkflow } from "../workflows/order-fulfilment/workflows/refund-unclaimed-payment"
import { tellCartNotPlaced } from "./buyer-notifications"
import { errorMessage } from "./errors"
import type { OrderRefundRecord } from "./order-fulfilment"
import { fixUnplacedCart } from "./unplaced-cart"

// A paid cart that fails to become orders (#38, ADR 0003). Mercur's payment webhook captures the
// payment, then completes the cart, and swallows a completion that fails: the money is taken and
// nothing is placed. A few seconds after the capture, once that completion has run, the cart is
// checked; if it isn't orders, completion is tried once more. If that fails too, the payment is
// refunded in full, the cart fixed (the used-up code, sold-out lines, gone offers and deliveries
// taken off), and the buyer told.

type Scope = Pick<MedusaContainer, "resolve">

/** A cart that wasn't placed, as checkout keeps it on the cart's metadata. */
export type StoredNotPlaced = NotPlaced & { currency_code: string; changes: NotPlacedChange[]; refund_id: string }

/** The cart metadata key a cart that wasn't placed is kept under. */
export const NOT_PLACED_KEY = "not_placed"

/** How long Mercur's capture may take to show before the payment counts as not captured. */
const CAPTURE_WAIT_MS = 60_000
/**
 * How long after the capture the cart is checked, and completed again if it isn't orders.
 * Mercur completes the cart straight after capturing, in about a second, and without the cart's
 * lock (it runs as a step of its webhook workflow, which skips locks), so there is no lock to
 * wait on: this gives it time to finish.
 */
const CHECK_AFTER_MS = 5_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

/**
 * After Mercur's handling of a successful payment for a live session: once the payment is
 * captured and Mercur's completion of the cart has had time to run, checks that the cart became
 * orders. If it didn't, tries completion once more (under the cart's lock), and if that fails
 * too, refunds it.
 */
export async function placeOrRefundPaidSession(scope: Scope, sessionId: string) {
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  let paid = await capturedPayment(scope, sessionId)
  for (const started = Date.now(); !paid && Date.now() - started < CAPTURE_WAIT_MS; ) {
    await sleep(250)
    paid = await capturedPayment(scope, sessionId)
  }
  // Nothing captured, nothing to refund: the money is in no Medusa payment (ADR 0003).
  if (!paid) return logger.warn(`Payment session ${sessionId} was paid but never captured`)

  await sleep(CHECK_AFTER_MS)
  if (await isPlaced(scope, paid.cart_id)) return
  try {
    await completeCartWithSplitOrdersWorkflow(scope as MedusaContainer).run({ input: { cart_id: paid.cart_id } })
    if (await isPlaced(scope, paid.cart_id)) return
  } catch (error) {
    logger.warn(`Cart ${paid.cart_id} was paid but failed to become orders twice: ${errorMessage(error)}`)
  }
  await refundUnplacedPayment(scope, paid.payment_id)
}

/**
 * Refunds in full a captured payment no order claims (under the lock every refund of it takes,
 * so it is refunded once however it is asked), then fixes its cart and keeps why it wasn't
 * placed. The accept-deadline job's backstop comes here too.
 */
export async function refundUnplacedPayment(scope: Scope, paymentId: string) {
  const { result: refund } = await refundUnclaimedPaymentWorkflow(scope as MedusaContainer).run({ input: { payment_id: paymentId } })
  if (!refund) return
  const cartId = await cartOfPayment(scope, paymentId)
  if (!cartId || (await isPlaced(scope, cartId))) return
  await recordNotPlaced(scope, cartId, refund)
}

/** Which reason a cart gives when fixing it found more than one thing wrong. */
const REASONS: NotPlacedReason[] = ["code_used_up", "sold_out", "unavailable", "delivery"]

/** Fixes the cart, keeps why it wasn't placed on it for checkout to show, and tells the buyer. */
async function recordNotPlaced(scope: Scope, cartId: string, refund: OrderRefundRecord) {
  const { changes, causes } = await fixUnplacedCart(scope, cartId)
  const notPlaced: StoredNotPlaced = {
    reason: REASONS.find((r) => causes.has(r)) ?? "other",
    amount: Number(refund.amount),
    currency_code: refund.currency_code,
    changes,
    refund_id: refund.id,
  }
  const carts = scope.resolve(Modules.CART)
  const cart = await carts.retrieveCart(cartId, { select: ["id", "metadata", "customer_id", "email"] })
  await carts.updateCarts(cartId, { metadata: { ...cart.metadata, [NOT_PLACED_KEY]: notPlaced } })
  await tellCartNotPlaced(scope, { cart_id: cartId, customer_id: cart.customer_id ?? null, email: cart.email ?? null, not_placed: notPlaced })
}
