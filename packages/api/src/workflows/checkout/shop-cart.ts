import { Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, transform, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  addToCartWorkflow,
  createCartWorkflow,
  deleteLineItemsWorkflow,
  deletePaymentSessionsWorkflow,
  releaseLockStep,
} from "@medusajs/medusa/core-flows"
import { withSharedCodes } from "../../lib/shared-codes"
import { planShopCartBack, planShopMove } from "../../lib/shop-cart"
import { applyShopPromotionsWorkflow } from "./apply-shop-promotions"
import { removeCartDeliveriesWorkflow } from "./remove-cart-deliveries"

// "Pay for this shop only" (#11, `lib/shop-cart.ts`): moving a shop's items to a shop cart, and
// back. Each move holds the lock Mercur's cart completion takes on the cart (its id, for as long
// as completion waits for it), so a Paystack webhook completes the cart either before the move,
// which then finds it paid and refuses, or after it. The sub-workflows' own cart locks are
// skipped inside a workflow. A step that fails undoes the steps before it.

const CART_LOCK = { timeout: 30, ttl: 120 }

export type MoveShopToOwnCartInput = { cartId: string; customerId: string; sellerId: string }
export type MoveShopCartBackInput = { cartId: string; shopCartId: string; customerId: string }

const planShopMoveStep = createStep("plan-shop-move", async (input: MoveShopToOwnCartInput, { container }) => {
  return new StepResponse(await planShopMove(container, input))
})

const planShopCartBackStep = createStep("plan-shop-cart-back", async (input: MoveShopCartBackInput, { container }) => {
  return new StepResponse(await planShopCartBack(container, input))
})

type ShareCodesInput = { cart_ids: [string, string]; codes: string[] }

/** Records on each of two carts the codes it shares with the other, which count one use (ADR 0010); no codes shares none. */
const shareCodesStep = createStep(
  "share-codes",
  async ({ cart_ids, codes }: ShareCodesInput, { container }) => {
    const carts = container.resolve(Modules.CART)
    const previous = (await carts.listCarts({ id: cart_ids }, { select: ["id", "metadata"] })).map(({ id, metadata }) => ({
      id,
      metadata: metadata ?? null,
    }))
    const [one, other] = cart_ids
    await carts.updateCarts(
      previous.map(({ id, metadata }) => ({ id, metadata: withSharedCodes(metadata, id === one ? other : one, codes) }))
    )
    return new StepResponse(undefined, previous)
  },
  async (previous, { container }) => {
    if (!previous?.length) return
    await container.resolve(Modules.CART).updateCarts(previous)
  }
)

/**
 * Moves one shop's items out of the buyer's cart into a new shop cart of theirs; returns its id.
 * The shop cart is filled first, so the cart loses nothing until its items are in it.
 */
export const moveShopToOwnCartWorkflow = createWorkflow(
  { name: "move-shop-to-own-cart" },
  function (input: MoveShopToOwnCartInput) {
    acquireLockStep({ key: input.cartId, ...CART_LOCK })
    const plan = planShopMoveStep(input)
    // A Paystack page opened for the whole cart then has no session: paying it is refunded (ADR 0003).
    deletePaymentSessionsWorkflow.runAsStep({ input: { ids: plan.payment_session_ids } })
    const shopCart = createCartWorkflow.runAsStep({ input: plan.shop_cart })
    addToCartWorkflow.runAsStep({
      input: transform({ plan, shopCart }, ({ plan, shopCart }) => ({ cart_id: shopCart.id, items: plan.items })),
    })
    const shopCartCodes = applyShopPromotionsWorkflow
      .runAsStep({
        input: transform({ plan, shopCart }, ({ plan, shopCart }) => ({ cart_id: shopCart.id, promo_codes: plan.codes })),
      })
      .config({ name: "apply-shop-cart-promotions" })
    deleteLineItemsWorkflow.runAsStep({ input: { cart_id: input.cartId, ids: plan.line_ids } })
    when("shop-had-delivery", { plan }, ({ plan }) => plan.delivery_ids.length > 0).then(() => {
      removeCartDeliveriesWorkflow.runAsStep({ input: { cart_id: input.cartId, shipping_method_ids: plan.delivery_ids } })
    })
    // The rest keeps the codes that still discount something in it.
    const cartCodes = applyShopPromotionsWorkflow
      .runAsStep({ input: { cart_id: input.cartId } })
      .config({ name: "apply-cart-promotions" })
    shareCodesStep(
      transform({ input, shopCart, shopCartCodes, cartCodes }, ({ input, shopCart, shopCartCodes, cartCodes }) => ({
        cart_ids: [input.cartId, shopCart.id] as [string, string],
        codes: shopCartCodes.codes.filter((code) => cartCodes.codes.includes(code)),
      }))
    )
    releaseLockStep({ key: input.cartId })
    return new WorkflowResponse(transform({ shopCart }, ({ shopCart }) => shopCart.id))
  }
)

/**
 * Moves a shop cart's items and codes back to the cart they came from, through add-to-cart, and
 * empties the shop cart. Its Paystack page then has no session: paying it is refunded (ADR 0003).
 */
export const moveShopCartBackWorkflow = createWorkflow(
  { name: "move-shop-cart-back" },
  function (input: MoveShopCartBackInput) {
    acquireLockStep({ key: [input.shopCartId, input.cartId], ...CART_LOCK })
    const plan = planShopCartBackStep(input)
    deletePaymentSessionsWorkflow.runAsStep({ input: { ids: plan.payment_session_ids } })
    when("shop-cart-had-items", { plan }, ({ plan }) => plan.items.length > 0).then(() => {
      addToCartWorkflow.runAsStep({ input: { cart_id: input.cartId, items: plan.items } })
    })
    applyShopPromotionsWorkflow
      .runAsStep({ input: { cart_id: input.cartId, promo_codes: plan.codes } })
      .config({ name: "apply-cart-promotions" })
    deleteLineItemsWorkflow.runAsStep({ input: { cart_id: input.shopCartId, ids: plan.line_ids } })
    when("shop-cart-had-delivery", { plan }, ({ plan }) => plan.delivery_ids.length > 0).then(() => {
      removeCartDeliveriesWorkflow.runAsStep({ input: { cart_id: input.shopCartId, shipping_method_ids: plan.delivery_ids } })
    })
    applyShopPromotionsWorkflow
      .runAsStep({ input: { cart_id: input.shopCartId, promo_codes: [] } })
      .config({ name: "apply-shop-cart-promotions" })
    shareCodesStep({ cart_ids: [input.cartId, input.shopCartId], codes: [] })
    releaseLockStep({ key: [input.shopCartId, input.cartId] })
    return new WorkflowResponse(undefined)
  }
)
