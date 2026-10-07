import { hasPermission } from "@medusajs/framework"
import { MedusaError, PolicyOperation } from "@medusajs/framework/utils"
import type { MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http"
import { MAY_CREATE_OFFERS } from "../offer-import/permissions"
import type { VendorRequest } from "../offer-import/seller"

// Quick-add (#38, docs/adr/0006-quick-add-permissions.md) is open to members who
// may create offers (owners and managers) and to fulfilment staff, who fulfil the
// shop's orders but hold no offer rights. Rather than give the stock Order
// Management role `offer:create` (and with it Mercur's offer routes), the route
// carries no RBAC policy and checks here; what staff may do through it is
// narrower still: only a new offer, never a change to one the shop has.
const FULFILS_ORDERS = [{ resource: "fulfillment", operation: PolicyOperation.create }]

/** Whether the member may quick-add for the shop they are acting for. */
export async function mayQuickAdd(req: VendorRequest<any>): Promise<boolean> {
  const roles = (req.auth_context?.app_metadata?.roles as string[] | undefined) ?? []
  if (!roles.length) return false
  const granted = (actions: { resource: string; operation: string }[]) => hasPermission({ roles, actions, container: req.scope })
  return (await granted(MAY_CREATE_OFFERS)) || (await granted(FULFILS_ORDERS))
}

/** Refuses members who may neither create offers nor fulfil orders (e.g. accounting, support). */
export async function requireQuickAdd(req: VendorRequest<any>, _res: MedusaResponse, next: MedusaNextFunction) {
  if (!(await mayQuickAdd(req))) {
    return next(new MedusaError(MedusaError.Types.FORBIDDEN, "Only owners, managers and fulfilment staff can add products."))
  }
  next()
}
