import { BUYER_ACTIVITY_DISMISS_AFTER_MS, type BuyerActivityContent, type BuyerActivityOutcome } from "./buyer-activity"
import type { StatusSymbol } from "./status"

/**
 * Android's counterpart of a Live Activity (#133): an Android 16 Live Update, or an ongoing
 * notification on older versions. The backend sends the same content as to Apple in a data-only
 * Expo push, and the phone draws it with `LiveUpdateView`, which holds only what a standard
 * notification can show: Android forbids custom views here. The vendor's view fills the parts the
 * buyer's leaves empty (segment colours, `countdownTo`).
 */

/** A colour for each appearance: the phone picks when it posts. */
export type ThemedColor = { light: string; dark: string }

/** The icons the native module bundles. */
export type LiveUpdateIcon = StatusSymbol | "bag"

export type LiveUpdateProgress = {
  /** The bar's parts in order, each as long as its share of the whole. */
  segments: { length: number; color?: ThemedColor }[]
  /** Marks along the bar, each a position from 1 to the segments' total length. */
  points: number[]
  /** Where the bar has reached, and the tracker sits. */
  position: number
  tracker: LiveUpdateIcon | null
  /** Whether Android dims what's past `position`. A bar that isn't progress turns this off. */
  styledByProgress: boolean
}

export type LiveUpdateView = {
  /** One notification per id: showing the same id again changes it in place. */
  id: string
  /** Anything older than what this id last showed is ignored: pushes can arrive out of order. */
  revision: number
  /** What tapping it opens. */
  url: string
  title: string
  text: string
  subText: string | null
  /** The Android 16 status-bar chip's text, about 7 characters at most. */
  chip: string | null
  icon: LiveUpdateIcon
  /** False once it's over: an ordinary notification, no longer promoted, that can be swiped away. */
  ongoing: boolean
  /** It goes by itself after this, so one whose last push never arrived can't stay for ever. */
  timeoutMs: number
  color: ThemedColor
  /** Android 16's bar. Null shows the whole text instead (BigTextStyle), which also qualifies for a Live Update. */
  progress: LiveUpdateProgress | null
  /** The standard bar on older Android, where segments don't exist. */
  olderBar: { max: number; current: number } | null
  /** A countdown to this time (ms), ticked by Android itself. */
  countdownTo: number | null
}

export type LiveUpdateMessage = {
  live_update: "buyer_shop_order"
  /** `show` starts or updates it, `end` shows the final state, `remove` takes it away at once. */
  action: "show" | "end" | "remove"
  order_id: string
  /** The server's time, so a late push can't undo a newer one. */
  revision: number
  url: string
  content: BuyerActivityContent
}

/** As long as iOS keeps an activity on the Lock Screen (8 hours, then up to 4 more). A later milestone shows it again. */
const LIVE_UPDATE_TIMEOUT_MS = 12 * 60 * 60 * 1000

/** A push older than this would only bring back something that has already gone. */
export const LIVE_UPDATE_TTL_SECONDS = LIVE_UPDATE_TIMEOUT_MS / 1000

const MAX_POINTS = 4

// The catalogue's accent on a card, in each appearance.
const ACCENT: ThemedColor = { light: "#1B2559", dark: "#AEB8FF" }

export function buyerLiveUpdateMessage({
  action,
  orderId,
  url,
  content,
  at,
}: {
  action: LiveUpdateMessage["action"]
  orderId: string
  url: string
  content: BuyerActivityContent
  at: number
}): LiveUpdateMessage {
  return { live_update: "buyer_shop_order", action, order_id: orderId, revision: at, url, content }
}

function endingLine(shop: string, outcome: BuyerActivityOutcome) {
  const refunded = (refund: string | null) => (refund ? ` You'll be refunded ${refund}.` : "")
  switch (outcome.kind) {
    case "delivered":
      return `Your order from ${shop} has arrived.`
    case "collected":
      return `You collected your order from ${shop}. Your receipt is in your email.`
    case "cancelled":
      return `${outcome.reason}.${refunded(outcome.refund)}`
    case "not_collected":
      return `It wasn't collected in time.${refunded(outcome.refund)}${outcome.kept ? ` Fresh items aren't refunded: ${outcome.kept}.` : ""}`
  }
}

/** A buyer's shop order as a notification, as drawn in the screens catalogue (#141). */
export function buyerLiveUpdateView({ order_id, revision, url, content }: LiveUpdateMessage): LiveUpdateView {
  const { step, shop, number, code, outcome } = content
  const shared = { id: order_id, revision, url, title: step.label, subText: number, color: ACCENT, countdownTo: null }
  if (outcome) {
    return {
      ...shared,
      text: endingLine(shop, outcome),
      chip: null,
      icon: "bag",
      ongoing: false,
      timeoutMs: BUYER_ACTIVITY_DISMISS_AFTER_MS,
      progress: null,
      olderBar: null,
    }
  }
  const stepLine = `Step ${step.index} of ${step.total}`
  return {
    ...shared,
    text: code ? `Code ${code} · Show this code at ${shop}.` : `${shop} · ${stepLine}${step.next ? ` · Next: ${step.next}` : ""}`,
    chip: code ? code.replace(/\s/g, "") : `${step.index} of ${step.total}`,
    icon: step.icon,
    ongoing: true,
    timeoutMs: LIVE_UPDATE_TIMEOUT_MS,
    progress: {
      segments: Array.from({ length: step.total - 1 }, () => ({ length: 1 })),
      // Android's points start at 1, and it draws only the first few, which would stop part-way along a
      // delivery's bar. There, the gaps between segments mark the steps alone.
      points: step.total - 1 <= MAX_POINTS ? Array.from({ length: step.total - 1 }, (_, point) => point + 1) : [],
      position: step.index - 1,
      tracker: step.icon,
      styledByProgress: true,
    },
    olderBar: { max: step.total, current: step.index },
  }
}

/** The message in what the phone's notification task was given; null for anything else. */
export function readLiveUpdateMessage(payload: unknown): LiveUpdateMessage | null {
  const dataString = (payload as { data?: { dataString?: unknown } } | null)?.data?.dataString
  if (typeof dataString !== "string") return null
  try {
    const message = JSON.parse(dataString) as Partial<LiveUpdateMessage> | null
    return message?.live_update ? (message as LiveUpdateMessage) : null
  } catch {
    return null
  }
}
