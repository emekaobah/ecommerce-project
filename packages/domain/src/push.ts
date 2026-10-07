/**
 * Where tapping a push notification takes the app (#27). A push carries the screen it is about
 * as `url`, a path inside the app (e.g. `/orders/order_123`); a vendor push also names the shop
 * (`seller_id`), so a member of several shops acts for that one before the screen opens.
 */
export type PushTarget = { path: string; sellerId: string | null }

/** The screen a push's data names, or null when it names none the app may open. */
export function pushTarget(data: unknown): PushTarget | null {
  if (!data || typeof data !== "object") return null
  const { url, seller_id: sellerId } = data as Record<string, unknown>
  // Only a path in this app: never another site or app, whoever managed to send the push.
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return null
  return { path: url, sellerId: typeof sellerId === "string" ? sellerId : null }
}
