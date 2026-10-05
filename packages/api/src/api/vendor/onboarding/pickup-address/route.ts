import type { MedusaResponse } from "@medusajs/framework/http"
import { updateSellerAddressWorkflow } from "@mercurjs/core/workflows"
import { validatedPickupChange } from "../../../../lib/delivery"
import { onboardingOf, pickupAddressFromForm, type Onboarding } from "../../../../lib/onboarding"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"
import type { VendorSavePickupAddressType } from "../validators"

/**
 * Sets the shop's pickup address from the country's address form (ADR 0002): checked against
 * the form, then validated with Shipbubble as it is saved. Answers the checklist.
 */
export const POST = async (
  req: VendorRequest<VendorSavePickupAddressType>,
  res: MedusaResponse<{ onboarding: Onboarding }>
) => {
  const sellerId = sellerOf(req)
  await updateSellerAddressWorkflow(req.scope).run({
    input: { seller_id: sellerId, data: await validatedPickupChange(req.scope, sellerId, pickupAddressFromForm(req.validatedBody)) },
  })
  res.json({ onboarding: await onboardingOf(req.scope, sellerId) })
}
