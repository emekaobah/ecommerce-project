import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { PaystackPaymentProviderService } from "./service"

import { PaystackClient } from "./client"

export { isPaystackSignatureValid } from "./client"

/**
 * Paystack's API outside the payment provider (e.g. checking a checkout's earlier transaction),
 * configured like the provider in medusa-config. Null when Paystack isn't configured.
 */
export function paystackClient(): PaystackClient | null {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  return secretKey ? new PaystackClient(secretKey, process.env.PAYSTACK_API_URL || undefined) : null
}

/** Medusa's id for the provider as medusa-config registers it (module provider `paystack`, id `paystack`). */
export const PAYSTACK_PROVIDER_ID = "pp_paystack_paystack"

export default ModuleProvider(Modules.PAYMENT, {
  services: [PaystackPaymentProviderService],
})
