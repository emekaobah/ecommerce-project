import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PAYSTACK_PROVIDER_ID } from "../../../../../modules/paystack"

/**
 * A cart paid with Paystack becomes orders only when Paystack's webhook confirms the payment
 * (docs/adr/0003-paystack-payments.md), so the store's complete route turns it away: no order
 * is placed, and no shop sees one, before the money is confirmed.
 */
export async function paystackCartsCompleteByWebhook(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["payment_collection.payment_sessions.provider_id"],
    filters: { id: req.params.id },
  })
  const sessions = (data[0] as { payment_collection?: { payment_sessions?: { provider_id: string }[] } } | undefined)
    ?.payment_collection?.payment_sessions
  if (sessions?.some((s) => s.provider_id === PAYSTACK_PROVIDER_ID)) {
    res.status(409).json({ message: "The order is placed when Paystack confirms the payment" })
    return
  }
  next()
}
