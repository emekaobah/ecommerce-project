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

/**
 * A new order's push (#83): the order it is about and its shop. The vendor app shows these
 * full screen while it is open, rather than as a banner.
 */
export type NewOrderPush = { orderId: string; sellerId: string | null }

/** The new order a push announces, or null for any other push. */
export function newOrderPush(data: unknown): NewOrderPush | null {
  if (!data || typeof data !== "object") return null
  const { kind, order_id: orderId, seller_id: sellerId } = data as Record<string, unknown>
  if (kind !== "new_order" || typeof orderId !== "string") return null
  return { orderId, sellerId: typeof sellerId === "string" ? sellerId : null }
}

/** What the vendor app knows when a push arrives while it is open. */
export type TakeoverState = {
  /** This phone's setting: the full-screen takeover, or a banner. */
  mode: "takeover" | "banner"
  signedIn: boolean
  /** The order the takeover is showing now, if any. */
  showing: string | null
  /** Orders already accepted, viewed or put off on this phone. */
  answered: ReadonlySet<string>
}

/**
 * Whether a push arriving while the vendor app is open takes over the screen (#83): a new
 * order's push, on a phone set to the takeover, with a member signed in. Never twice for the
 * order already showing, and never again for an order answered on this phone, however often its
 * push comes. Null shows the push as a banner, or not at all for the order already showing.
 */
export function newOrderTakeover(data: unknown, state: TakeoverState): NewOrderPush | null {
  if (state.mode !== "takeover" || !state.signedIn) return null
  const push = newOrderPush(data)
  if (!push || push.orderId === state.showing || state.answered.has(push.orderId)) return null
  return push
}

/**
 * The data for the banner a new order rings as when its takeover can't open after all (the
 * member's shop couldn't be checked, or they have left it): the push's own, less what marks it a
 * new order, so the banner opens the order when tapped and never tries to take over again.
 */
export function newOrderBanner(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {}
  const { kind: _kind, ...banner } = data as Record<string, unknown>
  return banner
}
