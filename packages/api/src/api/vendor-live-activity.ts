import type { MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { memberOfShop } from "../lib/vendor-live-activity"
import { hashDeviceKey, LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityTokenModuleService } from "../modules/live-activity-token"
import { setLiveActivityShopWorkflow } from "../workflows/live-activity-token/workflows"
import { keyOf, reportTokenFor } from "./live-activity-tokens"
import { sellerOf, type VendorRequest } from "./vendor/offer-import/seller"

// A member's phone and the shops it wants the Live Activity for (#146). The shop is the one the
// member is acting for, which Mercur has checked they're a member of; the phone is the one whose
// key they hold (ADR 0018). A phone reports its tokens with that key alone, as the buyer's does.

export const LiveActivityShopBody = z.object({ on: z.boolean() })
export type LiveActivityShopBodyType = z.infer<typeof LiveActivityShopBody>
export type LiveActivityShopResponse = { on: boolean }

/** The phone the request's key names, if it's this member's. */
async function membersDevice(req: VendorRequest<any>) {
  const key = keyOf(req)
  if (!key) return null
  const [device] = await req.scope
    .resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)
    .listLiveActivityDevices({ key_hash: hashDeviceKey(key), app: "vendor", actor_type: "member", actor_id: req.auth_context.actor_id })
  return device ?? null
}

/** A member's phone: the shop its activity's url names must be one the member is in. */
export const reportShopToken = reportTokenFor({
  app: "vendor",
  subject: "seller_id",
  owns: (scope, device, sellerId) => memberOfShop(scope, device.actor_id, sellerId),
  catchUp: (shop_activity) => ({ shop_activity }),
  spare: (seller_id, report) => ({ spare_shop: { seller_id, ...report } }),
})

/** Whether this phone has "Orders on Lock Screen" on for the shop. Off for a phone with no key yet. */
export const readShop = async (req: VendorRequest, res: MedusaResponse<LiveActivityShopResponse>) => {
  const device = await membersDevice(req)
  const shops = device
    ? await req.scope
        .resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)
        .listLiveActivityShops({ device_id: device.id, seller_id: sellerOf(req) })
    : []
  res.json({ on: shops.length > 0 })
}

/** Turns "Orders on Lock Screen" on or off for the shop, on this phone only. */
export const setShop = async (req: VendorRequest<LiveActivityShopBodyType>, res: MedusaResponse<LiveActivityShopResponse>) => {
  const device = await membersDevice(req)
  if (!device) throw new MedusaError(MedusaError.Types.NOT_FOUND, "This phone isn't registered")
  const { on } = req.validatedBody as LiveActivityShopBodyType
  const { result } = await setLiveActivityShopWorkflow(req.scope).run({ input: { device_id: device.id, seller_id: sellerOf(req), on } })
  res.json({ on: result.on })
}
