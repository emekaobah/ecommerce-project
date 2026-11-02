import {
  appIdentity,
  buyerActivityPlan,
  buyerActivityUrl,
  buyerLiveUpdateMessage,
  LIVE_UPDATE_TTL_SECONDS,
  type BuyerActivityContent,
  type FulfilmentState,
  type BuyerLiveUpdateMessage,
} from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityTokenModuleService } from "../modules/live-activity-token"
import { PUSH_TOKEN_MODULE, type PushTokenModuleService } from "../modules/push-token"
import { contentOf, type ActivityState } from "./buyer-activity-content"
import { buyerOrder } from "./buyer-notifications"
import { ordersOnLockScreenOn } from "./notification-preferences"
import { fulfilmentsOf } from "./order-fulfilment"
import { pushDataToDevices } from "./push-devices"

// A buyer's shop order as an Android Live Update (#148), by the same table, content and rules as
// their iPhone's Live Activity: it starts when the shop accepts, with the switch on, and only what
// started is updated or ended (`buyer_live_update`). iOS's 8-hour limit doesn't apply, so nothing
// restarts. Delivery is best-effort under Doze, so every normal push still goes.

type Scope = Pick<MedusaContainer, "resolve">
type Found = NonNullable<Awaited<ReturnType<typeof buyerOrder>>>

const tokenStore = (scope: Scope) => scope.resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)

async function androidPhonesOfBuyer(scope: Scope, customerId: string): Promise<string[]> {
  const tokens = await scope
    .resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE)
    .listPushTokens({ actor_type: "customer", actor_id: customerId, platform: "android" })
  return tokens.map(({ token }) => token)
}

/** What's recorded of this order on these phones. */
const recorded = (scope: Scope, orderId: string, devices: string[]) => tokenStore(scope).listBuyerLiveUpdates({ order_id: orderId, push_token: devices }, { take: null })

const running = (rows: { ended_at: Date | string | null; push_token: string }[]) => rows.filter((row) => !row.ended_at).map((row) => row.push_token)

async function send(
  scope: Scope,
  devices: string[],
  groupId: string,
  orderId: string,
  action: BuyerLiveUpdateMessage["action"],
  content: BuyerActivityContent,
  /** What makes this one message: a device gets it once, however often the event comes. */
  moment: string
) {
  const url = buyerActivityUrl(appIdentity("buyer").scheme, groupId, orderId)
  const outcome = await pushDataToDevices(scope, devices, {
    template: "buyer-live-update",
    data: buyerLiveUpdateMessage({ action, orderId, url, content, at: Date.now() }),
    ttl: LIVE_UPDATE_TTL_SECONDS,
    idempotencyKey: (to) => `buyer-live-update:${moment}:${orderId}:${to}`,
    about: `the Live Update of order ${orderId}`,
  })
  if (outcome.gone.length) {
    const forgotten = await tokenStore(scope).listBuyerLiveUpdates({ push_token: outcome.gone }, { select: ["id"], take: null })
    await tokenStore(scope).deleteBuyerLiveUpdates(forgotten.map(({ id }) => id))
  }
  return outcome
}

/**
 * Sends the order's last message to these phones and records it over. A phone Expo refused it for
 * stays running, so the next event about the order can try again.
 */
async function sendLast(scope: Scope, devices: string[], found: Found, orderId: string, action: "end" | "remove", content: BuyerActivityContent, moment: string) {
  const { gone, failed } = await send(scope, devices, found.checkout.group.id, orderId, action, content, moment)
  const over = devices.filter((device) => !gone.includes(device) && !failed.includes(device))
  if (!over.length) return
  const rows = await recorded(scope, orderId, over)
  await tokenStore(scope).updateBuyerLiveUpdates(rows.filter((row) => !row.ended_at).map(({ id }) => ({ id, ended_at: new Date() })))
}

/** The shop accepted, so these phones start showing the order. A repeat of the event finds them recorded. */
async function recordStarted(scope: Scope, orderId: string, customerId: string, devices: string[]) {
  await Promise.all(devices.map((push_token) => tokenStore(scope).createBuyerLiveUpdates({ push_token, order_id: orderId, customer_id: customerId }).catch(() => null)))
}

/**
 * The order reached `state`: the phones showing it are told, and acceptance starts it on the rest.
 * It shows where the order is now, since events can arrive out of order. With the switch off
 * nothing starts, and one a failed removal left showing is taken away.
 */
export async function showBuyerLiveUpdate(scope: Scope, orderId: string, state: FulfilmentState): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const now = found.order.fulfilment.state
  if (!["start", "update"].includes(buyerActivityPlan(now).action)) return
  const devices = await androidPhonesOfBuyer(scope, found.checkout.customer_id)
  if (!devices.length) return
  const rows = await recorded(scope, orderId, devices)
  const content = contentOf(found.checkout.number, found.order, now as ActivityState)
  if (!(await ordersOnLockScreenOn(scope, found.checkout.customer_id))) {
    if (running(rows).length) await sendLast(scope, running(rows), found, orderId, "remove", content, "remove")
    return
  }
  const fresh = buyerActivityPlan(state).action === "start" ? devices.filter((device) => !rows.some((row) => row.push_token === device)) : []
  await recordStarted(scope, orderId, found.checkout.customer_id, fresh)
  const showing = [...running(rows), ...fresh]
  if (!showing.length) return
  // An order can reach a state again (a courier label rebooked), and the phone is told each time.
  const reachedAt = (await fulfilmentsOf(scope, [orderId])).get(orderId)?.reached?.[state] ?? ""
  await send(scope, showing, found.checkout.group.id, orderId, "show", content, `${state}:${reachedAt}`)
}

/** The order finished: the phones still showing it show how, briefly. */
export async function endBuyerLiveUpdate(scope: Scope, found: Found, orderId: string, state: FulfilmentState, content: BuyerActivityContent): Promise<void> {
  const devices = await androidPhonesOfBuyer(scope, found.checkout.customer_id)
  if (!devices.length) return
  const showing = running(await recorded(scope, orderId, devices))
  if (showing.length) await sendLast(scope, showing, found, orderId, "end", content, state)
}

/**
 * The buyer turned "Orders on Lock Screen" off: every order showing goes at once (#145), and stays
 * gone. Each order is removed from a phone once, so the message needs no time in its key.
 */
export async function removeBuyerLiveUpdates(scope: Scope, customerId: string): Promise<void> {
  const devices = await androidPhonesOfBuyer(scope, customerId)
  if (!devices.length) return
  const rows = await tokenStore(scope).listBuyerLiveUpdates({ customer_id: customerId, push_token: devices, ended_at: null }, { take: null })
  await Promise.all(
    [...new Set(rows.map((row) => row.order_id))].map(async (orderId) => {
      const found = await buyerOrder(scope, orderId)
      if (!found) return
      const showing = rows.filter((row) => row.order_id === orderId).map((row) => row.push_token)
      await sendLast(scope, showing, found, orderId, "remove", contentOf(found.checkout.number, found.order, found.order.fulfilment.state as ActivityState), "remove")
    })
  )
}
