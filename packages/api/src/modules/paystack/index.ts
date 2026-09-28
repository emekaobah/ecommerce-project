import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { PaystackPaymentProviderService } from "./service"

export { isPaystackSignatureValid } from "./client"

/** Medusa's id for the provider as medusa-config registers it (module provider `paystack`, id `paystack`). */
export const PAYSTACK_PROVIDER_ID = "pp_paystack_paystack"

export default ModuleProvider(Modules.PAYMENT, {
  services: [PaystackPaymentProviderService],
})
