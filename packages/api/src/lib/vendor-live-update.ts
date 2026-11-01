import { LIVE_UPDATE_TTL_SECONDS, vendorLiveUpdateMessage, type VendorActivityContent, type VendorLiveUpdateMessage } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { PUSH_TOKEN_MODULE, type PushTokenModuleService } from "../modules/push-token"
import { pushDataToDevices } from "./push-devices"

// A shop's orders on an Android phone (#149): the same content as an iPhone's Live Activity, in a
// data-only Expo push the phone draws itself. `vendor-live-activity.ts` decides when, for both.

type Scope = Pick<MedusaContainer, "resolve">

/** Which of these phones are Android, by what each said when it registered for pushes: phone id to Expo token. */
export async function androidPhones(scope: Scope, phones: { id: string; push_token?: string | null }[]): Promise<Map<string, string>> {
  const linked = phones.filter((phone) => phone.push_token)
  if (!linked.length) return new Map()
  const rows = await scope
    .resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE)
    .listPushTokens({ token: linked.map((phone) => phone.push_token!), actor_type: "member", platform: "android" }, { select: ["token"], take: null })
  const android = new Set(rows.map(({ token }) => token))
  return new Map(linked.filter((phone) => android.has(phone.push_token!)).map((phone) => [phone.id, phone.push_token!]))
}

/** Sends the phone a message, answering as the Apple sender does, so a caller treats both alike. */
export async function pushShopLiveUpdate(
  scope: Scope,
  device: string,
  sellerId: string,
  url: string,
  action: VendorLiveUpdateMessage["action"],
  content: VendorActivityContent,
  at: number
): Promise<"sent" | "failed" | "token_rejected"> {
  const { gone, failed } = await pushDataToDevices(scope, [device], {
    template: "vendor-live-update",
    data: vendorLiveUpdateMessage({ action, sellerId, url, content, at }),
    ttl: LIVE_UPDATE_TTL_SECONDS,
    idempotencyKey: (to) => `vendor-live-update:${sellerId}:${action}:${at}:${to}`,
    about: `the Live Update of shop ${sellerId}`,
  })
  if (gone.length) return "token_rejected"
  return failed.length ? "failed" : "sent"
}
