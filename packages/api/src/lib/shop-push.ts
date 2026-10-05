import { acceptDeadline, acceptTimeLeft } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PUSH_CHANNEL } from "../modules/expo-push"
import { PUSH_TOKEN_MODULE, type PushTokenModuleService } from "../modules/push-token"
import { errorMessage } from "./errors"

// Pushes to a shop's members about one of its orders (#27): a new order, its accept deadline
// approaching, and a courier pickup scheduled. Each goes to every device of every member of the
// shop; tapping it opens the order (`url`), acting for the shop (`seller_id`).

type Scope = Pick<MedusaContainer, "resolve">

/** What happened to the order that the shop is told about. */
export type ShopPushKind = "order_placed" | "accept_deadline_near" | "pickup_scheduled"

type PushOrder = { id: string; display_id: number; created_at: string | Date; seller_id: string; items: number }

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

const MESSAGES: Record<ShopPushKind, (order: PushOrder, now: Date) => { title: string; body: string }> = {
  order_placed: (order) => ({
    title: `New order #${order.display_id}`,
    body: `${plural(order.items, "item")}. Accept or reject it in the app.`,
  }),
  accept_deadline_near: (order, now) => {
    const { label } = acceptTimeLeft(acceptDeadline(new Date(order.created_at).toISOString()), now)
    return {
      title: `Order #${order.display_id} is waiting`,
      body: `${label} to accept it, or it is rejected and refunded.`,
    }
  },
  pickup_scheduled: (order) => ({
    title: `Courier pickup booked for order #${order.display_id}`,
    body: "Have the parcel packed and ready at the counter.",
  }),
}

async function pushOrder(scope: Scope, orderId: string): Promise<PushOrder | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "created_at", "seller.id", "items.quantity"],
    filters: { id: orderId },
  })
  const order = data[0] as
    | { id: string; display_id: number; created_at: string | Date; seller?: { id: string } | null; items?: ({ quantity: unknown } | null)[] | null }
    | undefined
  if (!order?.seller) return null
  const items = (order.items ?? []).reduce((sum, item) => sum + Number(item?.quantity ?? 0), 0)
  return { id: order.id, display_id: order.display_id, created_at: order.created_at, seller_id: order.seller.id, items }
}

/** Every device of every member of the shop. */
async function shopDevices(scope: Scope, sellerId: string): Promise<string[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: members } = await query.graph({ entity: "seller_member", fields: ["member_id"], filters: { seller_id: sellerId } })
  const memberIds = (members as { member_id: string }[]).map((m) => m.member_id)
  if (!memberIds.length) return []
  const tokens = await scope
    .resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE)
    .listPushTokens({ actor_type: "member", actor_id: memberIds })
  return tokens.map((t) => t.token)
}

/**
 * Tells the order's shop what happened to it, on every member's device. Each device is told of
 * each event once, however often it is raised. A push Expo refuses (e.g. an app since
 * uninstalled) is logged; the other devices still get theirs.
 */
export async function pushToShop(scope: Scope, kind: ShopPushKind, orderId: string, now = new Date()): Promise<void> {
  const order = await pushOrder(scope, orderId)
  if (!order) return
  const devices = await shopDevices(scope, order.seller_id)
  if (!devices.length) return
  const { title, body } = MESSAGES[kind](order, now)
  try {
    await scope.resolve(Modules.NOTIFICATION).createNotifications(
      devices.map((to) => ({
        to,
        channel: PUSH_CHANNEL,
        template: `shop-${kind.replaceAll("_", "-")}`,
        content: { subject: title, text: body },
        data: { url: `/orders/${order.id}`, order_id: order.id, seller_id: order.seller_id },
        idempotency_key: `${kind}:${order.id}:${to}`,
      }))
    )
  } catch (error) {
    scope.resolve(ContainerRegistrationKeys.LOGGER).warn(`Pushing ${kind} for order ${orderId} failed: ${errorMessage(error)}`)
  }
}
