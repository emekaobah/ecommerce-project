import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ApplicationMethodTargetType } from "@medusajs/framework/utils"

/**
 * A shop's promotion discounts its items, never delivery (#6): Oja charges for delivery and pays
 * the courier itself, so a shop can't give it away. Only the operator's promotions discount it.
 */
export function shopsDontDiscountDelivery(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const body = req.body as { application_method?: { target_type?: string } } | undefined
  if (body?.application_method?.target_type === ApplicationMethodTargetType.SHIPPING_METHODS) {
    res.status(400).json({
      type: "invalid_data",
      message: "A shop's promotion can only discount its items: Oja charges for delivery and pays the courier.",
    })
    return
  }
  next()
}
