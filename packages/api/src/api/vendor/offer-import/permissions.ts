import { hasPermission } from "@medusajs/framework"
import { PolicyOperation } from "@medusajs/framework/utils"
import type { VendorRequest } from "./seller"

// A shop's import creates offers, so it needs the role that may create them:
// fulfilment staff are refused. Cost prices, and changes to offers the shop
// already has, are for those who may price offers: owners and managers (#37).
export const MAY_CREATE_OFFERS = [{ resource: "offer", operation: PolicyOperation.create }]
export const MAY_PRICE_OFFERS = [{ resource: "offer", operation: PolicyOperation.update }]

/** Whether the member may price the shop's offers, and so see and set their cost. */
export async function mayPriceOffers(req: VendorRequest<any>): Promise<boolean> {
  const roles = (req.auth_context.app_metadata?.roles as string[] | undefined) ?? []
  if (!roles.length) return false
  return hasPermission({ roles, actions: MAY_PRICE_OFFERS, container: req.scope })
}
