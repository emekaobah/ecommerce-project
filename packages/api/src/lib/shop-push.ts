import { acceptDeadline, acceptTimeLeft, type HandoverDisagreement, type ShopHours } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PUSH_CHANNEL } from "../modules/expo-push"
import { DEVICE_NOT_REGISTERED } from "../modules/expo-push/expo-api"
import { PUSH_TOKEN_MODULE, type PushTokenModuleService } from "../modules/push-token"
import { errorMessage } from "./errors"
import { forgetPushDevices } from "./push-receipts"
import { shopHoursOf } from "./shop-hours"

// Pushes to a shop's members about one of its orders (#27): a new order, its accept deadline
// approaching, and a courier pickup scheduled. Each goes to every device of every member of the
// shop; tapping it opens the order (`url`), acting for the shop (`seller_id`). A handover staff
// and the courier disagree about (#25) goes to the shop's owners only.

type Scope = Pick<MedusaContainer, "resolve">

/** What happened to the order that the shop is told about. */
export type ShopPushKind = "order_placed" | "accept_deadline_near" | "pickup_scheduled" | "handover_disagreement"

/** What the event said beyond the order: whose half of a disputed handover is missing. */
export type ShopPushDetail = { waiting_for?: HandoverDisagreement["waiting_for"] }

type PushOrder = { id: string; display_id: number; created_at: string | Date; seller_id: string; items: number }

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

type Message = (order: PushOrder, now: Date, hours: ShopHours | null, detail: ShopPushDetail) => { title: string; body: string }

/**
 * Each kind's message, and who gets it: every member, or the shop's owners only. A device gets
 * each event once, however often it is raised; a kind that `repeats` is told again each time it
 * is raised at a new time (the handover alert, daily while it lasts).
 */
const KINDS: Record<ShopPushKind, { message: Message; ownersOnly?: true; repeats?: true }> = {
  order_placed: {
    message: (order) => ({
      title: `New order #${order.display_id}`,
      body: `${plural(order.items, "item")}. Accept or reject it in the app.`,
    }),
  },
  accept_deadline_near: {
    message: (order, now, hours) => {
      // The reminder comes only while the deadline is set (the shop isn't paused for good).
      const deadline = acceptDeadline(new Date(order.created_at).toISOString(), hours) ?? now.toISOString()
      const { label } = acceptTimeLeft(deadline, now)
      return {
        title: `Order #${order.display_id} is waiting`,
        body: `${label} to accept it, or it is rejected and refunded.`,
      }
    },
  },
  pickup_scheduled: {
    message: (order) => ({
      title: `Courier pickup booked for order #${order.display_id}`,
      body: "Have the parcel packed and ready at the counter.",
    }),
  },
  handover_disagreement: {
    message: (order, _now, _hours, { waiting_for }) => ({
      title: `Check the handover of order #${order.display_id}`,
      body:
        waiting_for === "staff"
          ? "The courier says they collected it, but no one confirmed handing it over in the app."
          : "Your staff handed it over, but the courier hasn't reported picking it up.",
    }),
    ownersOnly: true,
    repeats: true,
  },
}

async function pushOrder(scope: Scope, orderId: string): Promise<PushOrder | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "created_at", "seller.id", "items.quantity"],
    filters: { id: orderId },
  })
  const order = data[0] as unknown as
    | { id: string; display_id: number; created_at: string | Date; seller?: { id: string } | null; items?: ({ quantity: unknown } | null)[] | null }
    | undefined
  if (!order?.seller) return null
  const items = (order.items ?? []).reduce((sum, item) => sum + Number(item?.quantity ?? 0), 0)
  return { id: order.id, display_id: order.display_id, created_at: order.created_at, seller_id: order.seller.id, items }
}

/** Every device of every member of the shop, or of its owners only. */
async function shopDevices(scope: Scope, sellerId: string, ownersOnly: boolean): Promise<string[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: members } = await query.graph({
    entity: "seller_member",
    fields: ["member_id"],
    filters: { seller_id: sellerId, ...(ownersOnly && { is_owner: true }) },
  })
  const memberIds = (members as { member_id: string }[]).map((m) => m.member_id)
  if (!memberIds.length) return []
  const tokens = await scope
    .resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE)
    .listPushTokens({ actor_type: "member", actor_id: memberIds })
  return tokens.map((t) => t.token)
}

/**
 * Tells the order's shop what happened to it, on every member's device. Each device is told of
 * each event once, however often it is raised. A device Expo says is no longer installed is
 * forgotten; any other push Expo refuses is logged. Either way the other devices get theirs.
 */
export async function pushToShop(
  scope: Scope,
  kind: ShopPushKind,
  orderId: string,
  now = new Date(),
  detail: ShopPushDetail = {}
): Promise<void> {
  const order = await pushOrder(scope, orderId)
  if (!order) return
  const { message, ownersOnly = false, repeats = false } = KINDS[kind]
  const devices = await shopDevices(scope, order.seller_id, ownersOnly)
  if (!devices.length) return
  const hours = (await shopHoursOf(scope, [order.seller_id], now)).get(order.seller_id) ?? null
  const { title, body } = message(order, now, hours, detail)
  const notifications = scope.resolve(Modules.NOTIFICATION)
  // One device a call, so a refusal is known to be that device's.
  const sent = await Promise.allSettled(
    devices.map((to) =>
      notifications.createNotifications({
        to,
        channel: PUSH_CHANNEL,
        template: `shop-${kind.replaceAll("_", "-")}`,
        content: { subject: title, text: body },
        data: { url: `/orders/${order.id}`, order_id: order.id, seller_id: order.seller_id },
        idempotency_key: [kind, order.id, to, ...(repeats ? [now.toISOString()] : [])].join(":"),
      })
    )
  )
  const gone: string[] = []
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  sent.forEach((result, i) => {
    if (result.status === "fulfilled") return
    const reason = errorMessage(result.reason)
    if (reason.includes(DEVICE_NOT_REGISTERED)) gone.push(devices[i])
    else logger.warn(`Pushing ${kind} for order ${orderId} failed: ${reason}`)
  })
  await forgetPushDevices(scope, gone)
}
