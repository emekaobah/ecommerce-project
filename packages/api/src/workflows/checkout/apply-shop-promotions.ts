import type { ComputeActionContext } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, PromotionActions } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  createLineItemAdjustmentsStep,
  createShippingMethodAdjustmentsStep,
  refreshPaymentCollectionForCartWorkflow,
  releaseLockStep,
  removeLineItemAdjustmentsStep,
  removeShippingMethodAdjustmentsStep,
  updateCartPromotionsStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { cartFieldsForRefreshSteps } from "@mercurjs/core/workflows/cart/utils/fields"
import { shopAdjustments, type PromotionOwner, type PromotionPass } from "../../lib/promotions"

export type ApplyShopPromotionsInput = {
  cart_id: string
  /** The codes the cart has; its current ones when not given. Automatic promotions always apply. */
  promo_codes?: string[]
}

type Adjusted = { id: string; adjustments?: { id: string }[] | null }
/** The cart as promotions are worked out on it: `cartFieldsForRefreshSteps`, with each line's shop. */
type PromotionCart = {
  items?: (Adjusted & { subtotal?: number | null; offer?: { seller_id: string } | null })[] | null
  shipping_methods?: Adjusted[] | null
  promotions?: { code?: string | null }[] | null
}

const withoutAdjustments = <T extends Adjusted>(rows: T[] | null | undefined) =>
  (rows ?? []).map(({ adjustments: _adjustments, ...row }) => row)

/** Works the cart's promotions out: a shop's on its own items, the operator's on the whole cart. */
const computeShopPromotionsStep = createStep(
  "compute-shop-promotions",
  async ({ cart, promo_codes }: { cart: PromotionCart; promo_codes: string[] }, { container }) => {
    const promotions = container.resolve(Modules.PROMOTION)
    const items = cart.items ?? []
    const sellerIds = [...new Set(items.flatMap((i) => (i.offer?.seller_id ? [i.offer.seller_id] : [])))]
    // Adjustments are replaced wholesale, so they are worked out as if the cart had none.
    const context = { ...cart, items: withoutAdjustments(items), shipping_methods: withoutAdjustments(cart.shipping_methods) }
    const passes: PromotionPass[] = await Promise.all([
      promotions
        .computeActions(promo_codes, context as unknown as ComputeActionContext)
        .then((actions) => ({ seller_id: null, actions })),
      ...sellerIds.map(async (sellerId) => {
        const own = { ...context, items: context.items.filter((i) => i.offer?.seller_id === sellerId), shipping_methods: [] }
        const actions = await promotions.computeActions(promo_codes, own as unknown as ComputeActionContext)
        return { seller_id: sellerId, actions }
      }),
    ])

    const codes = [...new Set(passes.flatMap((p) => p.actions.map((a) => a.code)))]
    const { data } = codes.length
      ? await container
          .resolve(ContainerRegistrationKeys.QUERY)
          .graph({ entity: "promotion", fields: ["id", "code", "seller.id"], filters: { code: codes } })
      : { data: [] }
    const owners = new Map<string, PromotionOwner>(
      (data as unknown as { id: string; code: string; seller?: { id: string } | null }[]).map((p) => [
        p.code,
        { id: p.id, seller_id: p.seller?.id ?? null },
      ])
    )
    const caps = new Map(items.map((i) => [i.id, Number(i.subtotal ?? 0)]))
    const result = shopAdjustments({ passes, owners, caps })

    return new StepResponse({
      lineItemAdjustmentsToCreate: result.items,
      lineItemAdjustmentIdsToRemove: items.flatMap((i) => (i.adjustments ?? []).map((a) => a.id)),
      shippingMethodAdjustmentsToCreate: result.shipping,
      shippingMethodAdjustmentIdsToRemove: (cart.shipping_methods ?? []).flatMap((m) => (m.adjustments ?? []).map((a) => a.id)),
      codes: result.codes,
      used_up: result.used_up,
    })
  }
)

/**
 * Applies the cart's promotions shop by shop (#6): replaces its discounts with those worked out
 * by `computeShopPromotionsStep`, keeps the codes that discount something, and totals its payment
 * collection again. Medusa works promotions out over the whole cart on every change to it, so
 * checkout runs this after each change it makes, and again before the buyer pays.
 * Returns the codes on the cart and those whose promotion is used up.
 */
export const applyShopPromotionsWorkflow = createWorkflow(
  { name: "apply-shop-promotions" },
  function (input: ApplyShopPromotionsInput) {
    const { data: cart } = useQueryGraphStep({
      entity: "cart",
      fields: [...cartFieldsForRefreshSteps, "items.offer.seller_id"],
      filters: { id: input.cart_id },
      options: { isList: false, throwIfKeyNotFound: true },
    })
    acquireLockStep({ key: input.cart_id, timeout: 2, ttl: 10 })
    const promo_codes = transform({ input, cart }, ({ input, cart }) => {
      const current = ((cart as unknown as PromotionCart).promotions ?? []).flatMap((p) => (p.code ? [p.code] : []))
      return input.promo_codes ?? current
    })
    const computed = computeShopPromotionsStep({ cart: cart as unknown as PromotionCart, promo_codes })
    removeLineItemAdjustmentsStep({ lineItemAdjustmentIdsToRemove: computed.lineItemAdjustmentIdsToRemove })
    removeShippingMethodAdjustmentsStep({ shippingMethodAdjustmentIdsToRemove: computed.shippingMethodAdjustmentIdsToRemove })
    createLineItemAdjustmentsStep({ lineItemAdjustmentsToCreate: computed.lineItemAdjustmentsToCreate })
    createShippingMethodAdjustmentsStep({ shippingMethodAdjustmentsToCreate: computed.shippingMethodAdjustmentsToCreate })
    updateCartPromotionsStep({ id: input.cart_id, promo_codes: computed.codes, action: PromotionActions.REPLACE })
    refreshPaymentCollectionForCartWorkflow.runAsStep({ input: { cart_id: input.cart_id } })
    releaseLockStep({ key: input.cart_id })
    const result = transform({ computed }, ({ computed }) => ({ codes: computed.codes, used_up: computed.used_up }))
    return new WorkflowResponse(result)
  }
)
