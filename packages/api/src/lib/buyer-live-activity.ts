import {
  appIdentity,
  BUYER_ACTIVITY_DISMISS_AFTER_MS,
  BUYER_ACTIVITY_FACTORY,
  buyerActivityContent,
  buyerActivityPlan,
  buyerActivityRestarts,
  buyerActivityUrl,
  buyerStatusPush,
  orderNumber,
  type BuyerActivityContent,
  type FulfilmentState,
  type RemovedItem,
} from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { LIVE_ACTIVITY_PUSH_MODULE, type LiveActivityPushModuleService } from "../modules/live-activity-push"
import type { LiveActivityPush } from "../modules/live-activity-push/service"
import { LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityTokenModuleService } from "../modules/live-activity-token"
import { hashDeviceKey } from "../workflows/live-activity-token/steps"
import { buyerOrder } from "./buyer-notifications"
import { errorMessage } from "./errors"
import { listBuyerOrderGroups, type BuyerOrder, type BuyerOrderGroup } from "./buyer-orders"

// A buyer's shop order on their Lock Screen and in the Dynamic Island (#133). Pushes go straight
// to Apple (ADR 0017), and what reaches the phone isn't known from Apple's answer, so the normal
// order pushes stay as they are unless `activityAlertReplacesPush` says otherwise.

type Scope = Pick<MedusaContainer, "resolve">

const tokens = (scope: Scope) => scope.resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)

type DeviceFacts = { update_token_reported_at: Date | string | null }

/**
 * Whether a start's alert stands in for the matching Expo push on this phone. A phone that has
 * reported an update token from an earlier activity has shown iOS lets it run them. Anything else
 * may be a buyer who refused Live Activities, whom Apple's 200 says nothing about (#140), so they
 * keep the push. "Don't Allow" hasn't been tested on a device; this is the rule to change if it is.
 */
export const activityAlertReplacesPush = (device: DeviceFacts) => device.update_token_reported_at != null

const senderOf = (scope: Scope) => scope.resolve<LiveActivityPushModuleService>(LIVE_ACTIVITY_PUSH_MODULE)

type ActivityState = Exclude<FulfilmentState, "new" | "rejected">
type Found = NonNullable<Awaited<ReturnType<typeof buyerOrder>>>
/** What only a cancelled or not collected order's own event knows. */
type Ending = { refund?: number; kept?: RemovedItem[] }

const contentOf = (number: string, order: BuyerOrder, state: ActivityState, { refund, kept }: Ending = {}): BuyerActivityContent =>
  buyerActivityContent({
    number,
    shop: order.seller.name,
    method: order.fulfilment.method,
    state,
    currency_code: order.currency_code,
    pickup_code: order.pickup?.code,
    cancellation: order.fulfilment.cancellation,
    refund: refund ?? order.refund?.amount ?? 0,
    kept,
  })

const contentPush = (content: BuyerActivityContent) => ({ app: "buyer" as const, content: { factory: BUYER_ACTIVITY_FACTORY, props: content } })

/** The state's push, as the activity's alert: named as clipped for it, and short of a pickup's address, which the code replaces. */
const alertOf = ({ checkout }: Found, content: BuyerActivityContent, state: FulfilmentState) => {
  const push = buyerStatusPush(state, { number: checkout.number, shop: content.shop, rejected_by: null })
  return push && { ...push, sound: "default" }
}

/** The running activities of an order on its buyer's phones. A phone that has since moved to someone else gets no more of it. */
async function runningActivities(scope: Scope, orderId: string, customerId: string) {
  const rows = await tokens(scope).listLiveActivities({ kind: "buyer_shop_order", subject_id: orderId, ended_at: null }, { relations: ["device"] })
  return rows.filter((row) => row.device.actor_type === "customer" && row.device.actor_id === customerId)
}

type Row = Awaited<ReturnType<typeof runningActivities>>[number]
/** An update or end, needing only the row's token and environment. */
type ToAnActivity = LiveActivityPush extends infer P ? (P extends { event: "update" | "end" } ? Omit<P, "token" | "environment"> : never) : never

/** Sends to an activity's own token, forgetting the activity if Apple says it's gone. */
async function sendToActivity(scope: Scope, row: Pick<Row, "id" | "token" | "environment">, push: ToAnActivity) {
  const sent = await senderOf(scope).send({ ...push, token: row.token!, environment: row.environment })
  if (sent.status === "token_rejected") await tokens(scope).deleteLiveActivities(row.id)
  return sent
}

/**
 * Asks Apple to start the activity on one phone, recording it first so a repeat of the event
 * can't start a second. Answers whether Apple took it; if not, nothing stays recorded.
 */
async function startOnDevice(
  scope: Scope,
  { checkout }: Found,
  orderId: string,
  device: { id: string; environment: "sandbox" | "production"; push_to_start_token: string | null },
  content: BuyerActivityContent,
  alert: { title: string; body: string; sound?: string }
) {
  const store = tokens(scope)
  let claim: { id: string }
  try {
    claim = await store.createLiveActivities({
      device_id: device.id,
      kind: "buyer_shop_order",
      subject_id: orderId,
      environment: device.environment,
      started_at: new Date(),
    })
  } catch (error) {
    scope.resolve(ContainerRegistrationKeys.LOGGER).warn(`Recording the Live Activity of order ${orderId} failed: ${errorMessage(error)}`)
    return false
  }
  const sent = await senderOf(scope).send({
    ...contentPush(content),
    event: "start",
    token: device.push_to_start_token!,
    environment: device.environment,
    priority: 10,
    alert,
    url: buyerActivityUrl(appIdentity("buyer").scheme, checkout.group.id, orderId),
  })
  if (sent.status === "sent") return true
  await store.deleteLiveActivities(claim.id)
  if (sent.status === "token_rejected") await store.updateLiveActivityDevices({ id: device.id, push_to_start_token: null })
  return false
}

/**
 * Starts the accepted order's activity on each of its buyer's phones that can be started by push.
 * Answers the Expo tokens whose accepted push the start's alert replaced. A phone Apple didn't
 * take the start for is left out, so it gets the push instead, and can be started again.
 *
 * It starts at Accepted, as the alert says, though accepting has moved the order on to picking.
 * That first update waits for the phone's token (`catchUpBuyerActivity`).
 */
export async function startBuyerActivity(scope: Scope, orderId: string): Promise<string[]> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return []
  const { checkout, order } = found
  const store = tokens(scope)
  const devices = await store.listLiveActivityDevices({
    app: "buyer",
    actor_type: "customer",
    actor_id: checkout.customer_id,
    push_to_start_token: { $ne: null },
  })
  if (!devices.length) return []

  const content = contentOf(checkout.number, order, "accepted")
  const alert = alertOf(found, content, "accepted")!

  const replaced = await Promise.all(
    devices.map(async (device) => {
      const replaces = activityAlertReplacesPush(device) ? device.push_token : null
      // Not on a repeat of the event: Apple's pushes have no idempotency key (ADR 0017), and iOS would show a second activity.
      const [running] = await store.listLiveActivities({ device_id: device.id, kind: "buyer_shop_order", subject_id: orderId, ended_at: null })
      if (running) return replaces
      return (await startOnDevice(scope, found, orderId, device, content, alert)) ? replaces : null
    })
  )
  return replaced.filter((token): token is string => !!token)
}

/**
 * Starts a fresh activity for a milestone past iOS's 8 hours, and ends the old one. Answers whether
 * Apple took the start; if not, the old activity stays as it was. The new row comes first, so the
 * old has to stop being the running one before it.
 */
async function restartOnDevice(scope: Scope, found: Found, row: Row, content: BuyerActivityContent, alert: { title: string; body: string; sound?: string }) {
  const store = tokens(scope)
  await store.updateLiveActivities({ id: row.id, ended_at: new Date() })
  if (!(await startOnDevice(scope, found, row.subject_id!, row.device, content, alert))) {
    await store.updateLiveActivities({ id: row.id, ended_at: null })
    return false
  }
  if (row.token) await sendToActivity(scope, row, { ...contentPush(content), event: "end", priority: 10, dismissAt: new Date() })
  return true
}

/**
 * Moves the order's activities on to `state`. Answers the Expo tokens whose push for it a fresh
 * activity's alert replaced. Rows with no token yet wait for `catchUpBuyerActivity`.
 */
async function updateBuyerActivity(scope: Scope, orderId: string, state: FulfilmentState): Promise<string[]> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return []
  const { checkout, order } = found
  // What it shows is where the order is now: events can arrive out of order, and an ending has its own.
  const now = order.fulfilment.state
  if (buyerActivityPlan(now).action !== "update") return []
  const content = contentOf(checkout.number, order, now as ActivityState)
  const { priority, alert: alerts } = buyerActivityPlan(state)
  const alert = alerts ? alertOf(found, content, state) : null

  const rows = await runningActivities(scope, orderId, checkout.customer_id)
  const replaced = await Promise.all(
    rows.map(async (row) => {
      if (alert && row.device.push_to_start_token && buyerActivityRestarts(state, new Date(row.started_at), new Date())) {
        if (await restartOnDevice(scope, found, row, content, alert)) return activityAlertReplacesPush(row.device) ? row.device.push_token : null
      }
      if (row.token) await sendToActivity(scope, row, { ...contentPush(content), event: "update", priority, ...(alert ? { alert } : {}) })
      return null
    })
  )
  return replaced.filter((token): token is string => !!token)
}

/**
 * Ends the order's activities at its final state, shown briefly and then dismissed. A row with
 * no token yet is marked too: when its token arrives, `catchUpBuyerActivity` ends it.
 */
export async function endBuyerActivity(scope: Scope, orderId: string, state: ActivityState, ending: Ending = {}): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const content = contentOf(found.checkout.number, found.order, state, ending)
  const dismissAt = new Date(Date.now() + BUYER_ACTIVITY_DISMISS_AFTER_MS)
  await Promise.all(
    (await runningActivities(scope, orderId, found.checkout.customer_id)).map((row) => finish(scope, row, content, dismissAt))
  )
}

async function finish(scope: Scope, row: Pick<Row, "id" | "token" | "environment" | "ended_at">, content: BuyerActivityContent, dismissAt: Date) {
  const sent = row.token ? await sendToActivity(scope, row, { ...contentPush(content), event: "end", priority: 10, dismissAt }) : null
  if (sent?.status !== "token_rejected" && !row.ended_at) await tokens(scope).updateLiveActivities({ id: row.id, ended_at: new Date() })
}

/** A pickup order's hold ended: `order_fulfilment.not_collected`'s data says what's refunded and which lines aren't. */
export async function endNotCollectedActivity(scope: Scope, { id, amount, kept }: { id: string; amount: number; kept: Record<string, number> }): Promise<void> {
  const found = await buyerOrder(scope, id)
  if (!found) return
  const items = Object.entries(kept).flatMap(([lineId, quantity]) => {
    const line = found.order.items.find((item) => item.id === lineId)
    return line && quantity > 0 ? [{ title: line.product_title ?? "Item", quantity }] : []
  })
  await endBuyerActivity(scope, id, "not_collected", { refund: amount, kept: items })
}

/**
 * Ends every activity a buyer has running, at once, showing where each order is: for when they
 * turn "Orders on Lock Screen" off (#145). One still waiting for its token ends when that arrives.
 */
export async function endBuyerActivities(scope: Scope, customerId: string): Promise<void> {
  const store = tokens(scope)
  const devices = await store.listLiveActivityDevices({ app: "buyer", actor_type: "customer", actor_id: customerId })
  if (!devices.length) return
  const rows = await store.listLiveActivities({ device_id: devices.map(({ id }) => id), kind: "buyer_shop_order", ended_at: null })
  await Promise.all(
    rows.map(async (row) => {
      const found = row.subject_id ? await buyerOrder(scope, row.subject_id) : null
      const state = found?.order.fulfilment.state
      if (!found || !state || buyerActivityPlan(state).action === "none") return
      await finish(scope, row, contentOf(found.checkout.number, found.order, state as ActivityState), new Date())
    })
  )
}

/**
 * What a fulfilment state does to the buyer's activity, by the table in `@oja/domain`. Answers
 * the Expo tokens whose push for that state an activity's alert replaced.
 */
export async function moveBuyerActivity(scope: Scope, orderId: string, state: FulfilmentState): Promise<string[]> {
  const { action } = buyerActivityPlan(state)
  if (action === "start") return startBuyerActivity(scope, orderId)
  if (action === "update") return updateBuyerActivity(scope, orderId, state)
  // Cancelled and not collected end from their own events, which say what was refunded.
  if (state === "delivered" || state === "collected") await endBuyerActivity(scope, orderId, state)
  return []
}

export const LIVE_ACTIVITY_TOKEN_REPORTED = "live_activity.token_reported"
/** An activity to catch up, by its row, or a second one for an order already followed, which has none. */
export type LiveActivityTokenReported = { id: string } | { spare: { order_id: string; token: string; environment: "sandbox" | "production" } }

/**
 * An activity's token has arrived, seconds or days after its start, so it can be told what it
 * missed: accepting has already moved the order on to picking, and the order may have finished.
 */
export async function catchUpBuyerActivity(scope: Scope, activityId: string): Promise<void> {
  const [row] = await tokens(scope).listLiveActivities({ id: activityId })
  if (!row?.token || !row.subject_id) return
  const found = await buyerOrder(scope, row.subject_id)
  if (!found) return
  const state = found.order.fulfilment.state
  const { action } = buyerActivityPlan(state)
  if (action === "none") return
  const content = contentOf(found.checkout.number, found.order, state as ActivityState)
  if (action === "end") await finish(scope, row, content, new Date(Date.now() + BUYER_ACTIVITY_DISMISS_AFTER_MS))
  // Ended already, by a restart or the buyer's switch, while its token was on the way.
  else if (row.ended_at) await finish(scope, row, content, new Date())
  else await sendToActivity(scope, row, { ...contentPush(content), event: "update", priority: 5 })
}

/** A second activity on a phone for an order it already follows has no row to follow it by: it ends at once. */
export async function endSpareBuyerActivity(
  scope: Scope,
  { order_id, token, environment }: { order_id: string; token: string; environment: "sandbox" | "production" }
): Promise<void> {
  const found = await buyerOrder(scope, order_id)
  const state = found?.order.fulfilment.state
  if (!found || !state || buyerActivityPlan(state).action === "none") return
  const content = contentOf(found.checkout.number, found.order, state as ActivityState)
  await senderOf(scope).send({ ...contentPush(content), event: "end", token, environment, priority: 10, dismissAt: new Date() })
}

/** Where an order has been accepted and isn't finished: when a phone should be showing it. */
const RUNS_AN_ACTIVITY = new Set<FulfilmentState>([
  "accepted",
  "picking",
  "partially_available",
  "packed",
  "label_booked",
  "courier_confirmed",
  "handed_to_courier",
  "in_transit",
  "ready_for_pickup",
])

export type OwedActivity = { order_id: string; url: string; content: BuyerActivityContent }

/**
 * The buyer's accepted shop orders this phone should be showing and doesn't, for a phone on iOS
 * below 17.2 to start itself. Empty for a phone the server starts by push.
 */
export async function owedBuyerActivities(scope: Scope, customerId: string, key: string): Promise<OwedActivity[]> {
  const store = tokens(scope)
  const [device] = await store.listLiveActivityDevices({ key_hash: hashDeviceKey(key), actor_type: "customer", actor_id: customerId })
  if (!device || device.push_to_start_token) return []
  const { order_groups } = await listBuyerOrderGroups(scope, customerId, { phase: "in_progress" }, null)
  const orders = order_groups.flatMap((group: BuyerOrderGroup) =>
    group.orders.filter((order) => RUNS_AN_ACTIVITY.has(order.fulfilment.state)).map((order) => ({ group, order }))
  )
  if (!orders.length) return []
  const running = await store.listLiveActivities({
    device_id: device.id,
    kind: "buyer_shop_order",
    subject_id: orders.map(({ order }) => order.id),
    ended_at: null,
  })
  const started = new Set(running.map((activity) => activity.subject_id))
  return orders
    .filter(({ order }) => !started.has(order.id))
    .map(({ group, order }) => ({
      order_id: order.id,
      url: buyerActivityUrl(appIdentity("buyer").scheme, group.id, order.id),
      content: contentOf(orderNumber(group.display_id), order, order.fulfilment.state as Exclude<FulfilmentState, "new" | "rejected">),
    }))
}
