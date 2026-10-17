import { acceptDeadline, acceptTimeLeft, type HandoverDisagreement, type ShopHours } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SellerRole } from "@mercurjs/types"
import { PUSH_TOKEN_MODULE, type PushTokenModuleService } from "../modules/push-token"
import { pushToDevices } from "./push-devices"
import { shopHoursOf } from "./shop-hours"

// Pushes to a shop's members about one of its orders (#27): a new order, its accept deadline
// approaching, and a courier pickup scheduled. Each goes to every device of every member of the
// shop; tapping it opens the order (`url`), acting for the shop (`seller_id`). A handover staff
// and the courier disagree about (#25) goes to the shop's owners only, and a pickup order not
// collected (#33) to its owners and managers.

type Scope = Pick<MedusaContainer, "resolve">

/** What happened to the order that the shop is told about. */
export type ShopPushKind = "order_placed" | "accept_deadline_near" | "pickup_scheduled" | "handover_disagreement" | "not_collected"

/**
 * What the event said beyond the order: whose half of a disputed handover is missing, and
 * whether a pickup order not collected kept perishable lines for the shop.
 */
export type ShopPushDetail = { waiting_for?: HandoverDisagreement["waiting_for"]; perishable_kept?: boolean }

/**
 * Who in the shop is told: every member, its owners, or its owners and managers (the shop's
 * administration role, which owners have too).
 */
type Audience = "members" | "owners" | "managers"

type PushOrder = { id: string; display_id: number; created_at: string | Date; seller_id: string; items: number }

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

type Message = (order: PushOrder, now: Date, hours: ShopHours | null, detail: ShopPushDetail) => { title: string; body: string }

/**
 * Each kind's message, and who gets it (every member unless it says). A device gets
 * each event once, however often it is raised; a kind that `repeats` is told again each time it
 * is raised at a new time (the handover alert, daily while it lasts).
 */
const KINDS: Record<ShopPushKind, { message: Message; to?: Audience; repeats?: true }> = {
  order_placed: {
    message: (order) => ({
      title: `New order #${order.display_id}`,
      body: `${plural(order.items, "item")}. Accept or reject it in the app.`,
    }),
  },
  accept_deadline_near: {
    message: (order, now, hours) => {
      // The reminder comes only while the deadline is set (the shop reopens to finish the clock).
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
    to: "owners",
    repeats: true,
  },
  not_collected: {
    message: (order, _now, _hours, { perishable_kept }) => ({
      title: `Order #${order.display_id} wasn't collected`,
      body: perishable_kept
        ? "Its hold ended. Put its other items back on the shelf: they're refunded. Its fresh items aren't: they're paid out to you."
        : "Its hold ended and the buyer is refunded. Put its items back on the shelf.",
    }),
    to: "managers",
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

const IN_AUDIENCE: Record<Audience, (member: { is_owner: boolean; role_id: string | null }) => boolean> = {
  members: () => true,
  owners: (m) => m.is_owner,
  managers: (m) => m.is_owner || m.role_id === SellerRole.SELLER_ADMINISTRATION,
}

/** Every device of the shop's members in the audience. */
async function shopDevices(scope: Scope, sellerId: string, audience: Audience): Promise<string[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "seller_member",
    fields: ["member_id", "is_owner", "role_id"],
    filters: { seller_id: sellerId },
  })
  const members = data as unknown as { member_id: string; is_owner: boolean; role_id: string | null }[]
  const memberIds = members.filter(IN_AUDIENCE[audience]).map((m) => m.member_id)
  if (!memberIds.length) return []
  const tokens = await scope
    .resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE)
    .listPushTokens({ actor_type: "member", actor_id: memberIds })
  return tokens.map((t) => t.token)
}

/**
 * Tells the order's shop what happened to it, on the devices of the members it is for. Each device is told of
 * each event once, however often it is raised.
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
  const { message, to = "members", repeats = false } = KINDS[kind]
  const devices = await shopDevices(scope, order.seller_id, to)
  if (!devices.length) return
  const hours = (await shopHoursOf(scope, [order.seller_id], now)).get(order.seller_id) ?? null
  const { title, body } = message(order, now, hours, detail)
  await pushToDevices(scope, devices, {
    template: `shop-${kind.replaceAll("_", "-")}`,
    title,
    body,
    data: { url: `/orders/${order.id}`, order_id: order.id, seller_id: order.seller_id },
    idempotencyKey: (to) => [kind, order.id, to, ...(repeats ? [now.toISOString()] : [])].join(":"),
    about: `${kind} for order ${orderId}`,
  })
}
