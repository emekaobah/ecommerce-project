import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

export type VendorRequest<Body = unknown> = AuthenticatedMedusaRequest<Body> & { seller_context?: { seller_id: string } }

/** The shop the request acts for, which Mercur's vendor middleware sets. */
export const sellerOf = (req: VendorRequest<any>) => {
  const sellerId = req.seller_context?.seller_id
  if (!sellerId) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Choose a shop first.")
  return sellerId
}
