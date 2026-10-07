import type { MedusaResponse } from "@medusajs/framework/http"
import { onboardingOf, type Onboarding } from "../../../lib/onboarding"
import { sellerOf, type VendorRequest } from "../offer-import/seller"

/** The shop's onboarding checklist: what is done and what is still missing before it goes live (#26). */
export const GET = async (req: VendorRequest, res: MedusaResponse<{ onboarding: Onboarding }>) => {
  res.json({ onboarding: await onboardingOf(req.scope, sellerOf(req)) })
}
