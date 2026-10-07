import type { MedusaResponse } from "@medusajs/framework/http"
import { onboardingOf, saveBankAccount, type Onboarding } from "../../../../lib/onboarding"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"
import type { VendorSaveBankAccountType } from "../validators"

/** Sets the account the shop is paid into, once Paystack has resolved it; answers the checklist. */
export const POST = async (req: VendorRequest<VendorSaveBankAccountType>, res: MedusaResponse<{ onboarding: Onboarding }>) => {
  const sellerId = sellerOf(req)
  await saveBankAccount(req.scope, sellerId, req.validatedBody)
  res.json({ onboarding: await onboardingOf(req.scope, sellerId) })
}
