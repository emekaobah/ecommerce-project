import { refreshCartItemsWorkflow, removeShippingMethodFromCartStep } from "@medusajs/medusa/core-flows"
import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

export type RemoveCartDeliveriesInput = { cart_id: string; shipping_method_ids: string[] }

/**
 * Takes deliveries off a cart, then totals it again (and its payment collection). Checkout uses
 * it for a shop whose last item the buyer removed, whose delivery Medusa leaves on the cart.
 */
export const removeCartDeliveriesWorkflow = createWorkflow(
  { name: "remove-cart-deliveries" },
  function (input: RemoveCartDeliveriesInput) {
    removeShippingMethodFromCartStep({ shipping_method_ids: input.shipping_method_ids })
    refreshCartItemsWorkflow.runAsStep({ input: { cart_id: input.cart_id } })
    return new WorkflowResponse(void 0)
  }
)
