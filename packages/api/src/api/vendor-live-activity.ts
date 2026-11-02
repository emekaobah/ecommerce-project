import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { LIVE_ACTIVITY_TOKEN_REPORTED, type LiveActivityTokenReported } from "../lib/buyer-live-activity"
import { memberOfShop } from "../lib/vendor-live-activity"
import { hashDeviceKey, LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityTokenModuleService } from "../modules/live-activity-token"
import {
  reportLiveActivityTokenWorkflow,
  setLiveActivityShopWorkflow,
} from "../workflows/live-activity-token/workflows"
import {
  deviceOf,
  keyOf,
  type LiveActivityTokenResponse,
  type VendorLiveActivityTokenBodyType,
} from "./live-activity-tokens"
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

/** Takes a token from a phone, with its key. The shop its url names is trusted only if it's the member's. */
export const reportShopToken = async (req: MedusaRequest<VendorLiveActivityTokenBodyType>, res: MedusaResponse<LiveActivityTokenResponse>) => {
  const device = await deviceOf(req, "vendor")
  const body = req.validatedBody as VendorLiveActivityTokenBodyType
  if (body.kind === "push_to_start") {
    const { result } = await reportLiveActivityTokenWorkflow(req.scope).run({ input: { ...body, device_id: device.id } })
    res.json({ token: result.token })
    return
  }
  const { seller_id, ...report } = body
  const subject_id = seller_id && (await memberOfShop(req.scope, device.actor_id, seller_id)) ? seller_id : undefined
  const { result } = await reportLiveActivityTokenWorkflow(req.scope).run({ input: { ...report, device_id: device.id, subject_id } })
  const reported: LiveActivityTokenReported | null = result.catch_up
    ? { shop_activity: result.catch_up }
    : result.spare && subject_id
      ? { spare_shop: { seller_id: subject_id, token: report.token, environment: report.environment } }
      : null
  if (reported) await req.scope.resolve(Modules.EVENT_BUS).emit({ name: LIVE_ACTIVITY_TOKEN_REPORTED, data: reported })
  res.json({ token: result.token })
}

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
