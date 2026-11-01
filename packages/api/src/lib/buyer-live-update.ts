import {
  appIdentity,
  buyerActivityPlan,
  buyerActivityUrl,
  buyerLiveUpdateMessage,
  LIVE_UPDATE_TTL_SECONDS,
  orderNumber,
  type BuyerActivityContent,
  type FulfilmentState,
  type LiveUpdateMessage,
} from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { PUSH_TOKEN_MODULE, type PushTokenModuleService } from "../modules/push-token"
import { contentOf, RUNS_AN_ACTIVITY, type ActivityState } from "./buyer-activity-content"
import { buyerOrder } from "./buyer-notifications"
import { listBuyerOrderGroups } from "./buyer-orders"
import { ordersOnLockScreenOn } from "./notification-preferences"
import { fulfilmentsOf } from "./order-fulfilment"
import { pushDataToDevices } from "./push-devices"

// A buyer's shop order as an Android Live Update (#148), by the same table and content as their
// iPhone's Live Activity. The phone keeps no token per order and iOS's 8-hour limit doesn't apply,
// so there's nothing to record or restart: a message to the buyer's Android phones starts or
// updates the notification alike, and a late milestone simply shows it again. Delivery is
// best-effort under Doze, so every normal push still goes.

type Scope = Pick<MedusaContainer, "resolve">
type Found = NonNullable<Awaited<ReturnType<typeof buyerOrder>>>

async function androidPhones(scope: Scope, customerId: string): Promise<string[]> {
  const tokens = await scope
    .resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE)
    .listPushTokens({ actor_type: "customer", actor_id: customerId, platform: "android" })
  return tokens.map(({ token }) => token)
}

async function send(
  scope: Scope,
  devices: string[],
  groupId: string,
  orderId: string,
  action: LiveUpdateMessage["action"],
  content: BuyerActivityContent,
  /** What makes this one message: a device gets it once, however often the event comes. */
  moment: string
) {
  const url = buyerActivityUrl(appIdentity("buyer").scheme, groupId, orderId)
  await pushDataToDevices(scope, devices, {
    template: "buyer-live-update",
    data: buyerLiveUpdateMessage({ action, orderId, url, content, at: Date.now() }),
    ttl: LIVE_UPDATE_TTL_SECONDS,
    idempotencyKey: (to) => `buyer-live-update:${moment}:${orderId}:${to}`,
    about: `the Live Update of order ${orderId}`,
  })
}

/** The order reached `state`, which starts or updates its Live Update. It shows where the order is now: events can arrive out of order. */
export async function showBuyerLiveUpdate(scope: Scope, orderId: string, state: FulfilmentState): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const now = found.order.fulfilment.state
  if (!["start", "update"].includes(buyerActivityPlan(now).action)) return
  const devices = await androidPhones(scope, found.checkout.customer_id)
  if (!devices.length || !(await ordersOnLockScreenOn(scope, found.checkout.customer_id))) return
  const content = contentOf(found.checkout.number, found.order, now as ActivityState)
  // An order can reach a state again (a courier label rebooked), and the phone is told each time.
  const reachedAt = (await fulfilmentsOf(scope, [orderId])).get(orderId)?.reached?.[state] ?? ""
  await send(scope, devices, found.checkout.group.id, orderId, "show", content, `${state}:${reachedAt}`)
}

/** The order finished: its Live Update shows how, briefly. With the switch off there's nothing showing to end. */
export async function endBuyerLiveUpdate(scope: Scope, found: Found, orderId: string, state: FulfilmentState, content: BuyerActivityContent): Promise<void> {
  const devices = await androidPhones(scope, found.checkout.customer_id)
  if (!devices.length || !(await ordersOnLockScreenOn(scope, found.checkout.customer_id))) return
  await send(scope, devices, found.checkout.group.id, orderId, "end", content, state)
}

/** The buyer turned "Orders on Lock Screen" off: every order showing goes at once (#145). */
export async function removeBuyerLiveUpdates(scope: Scope, customerId: string): Promise<void> {
  const devices = await androidPhones(scope, customerId)
  if (!devices.length) return
  const { order_groups } = await listBuyerOrderGroups(scope, customerId, { phase: "in_progress" }, null)
  const at = Date.now()
  await Promise.all(
    order_groups.flatMap((group) =>
      group.orders
        .filter((order) => RUNS_AN_ACTIVITY.has(order.fulfilment.state))
        .map((order) => {
          const content = contentOf(orderNumber(group.display_id), order, order.fulfilment.state as ActivityState)
          // Once per turning off: it can be turned on and off again.
          return send(scope, devices, group.id, order.id, "remove", content, `off:${at}`)
        })
    )
  )
}
