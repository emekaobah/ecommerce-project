import {
  appIdentity,
  BUYER_ACTIVITY_FACTORY,
  buyerActivityContent,
  buyerStatusPush,
  orderNumber,
  type BuyerActivityContent,
  type FulfilmentState,
} from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { LIVE_ACTIVITY_PUSH_MODULE, type LiveActivityPushModuleService } from "../modules/live-activity-push"
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

/** What tapping an activity opens: the checkout's order screen, as a push does. */
const activityUrl = (groupId: string) => `${appIdentity("buyer").scheme}://order/${groupId}`

function contentOf(number: string, order: BuyerOrder, state: Exclude<FulfilmentState, "new" | "rejected">): BuyerActivityContent {
  return buyerActivityContent({
    number,
    shop: order.seller.name,
    method: order.fulfilment.method,
    state,
    currency_code: order.currency_code,
    pickup_code: order.pickup?.code,
    cancellation: order.fulfilment.cancellation,
  })
}

/**
 * Starts the accepted order's activity on each of its buyer's phones that can be started by push.
 * Answers the Expo tokens whose accepted push the start's alert replaced. A phone Apple didn't
 * take the start for is left out, so it gets the push instead, and can be started again.
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

  const sender = scope.resolve<LiveActivityPushModuleService>(LIVE_ACTIVITY_PUSH_MODULE)
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const content = contentOf(checkout.number, order, "accepted")
  // In the same words as the push it can stand in for, with the name as clipped for the activity.
  const alert = buyerStatusPush("accepted", { number: checkout.number, shop: content.shop, rejected_by: null })!

  const replaced = await Promise.all(
    devices.map(async (device) => {
      const replaces = activityAlertReplacesPush(device) ? device.push_token : null
      // Not on a repeat of the event: Apple's pushes have no idempotency key (ADR 0017), and iOS would show a second activity.
      const [running] = await store.listLiveActivities({ device_id: device.id, kind: "buyer_shop_order", subject_id: orderId, ended_at: null })
      if (running) return replaces
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
        logger.warn(`Recording the Live Activity of order ${orderId} failed: ${errorMessage(error)}`)
        return null
      }
      const sent = await sender.send({
        event: "start",
        app: "buyer",
        token: device.push_to_start_token!,
        environment: device.environment,
        priority: 10,
        content: { factory: BUYER_ACTIVITY_FACTORY, props: content },
        alert: { ...alert, sound: "default" },
        url: activityUrl(checkout.group.id),
      })
      if (sent.status === "sent") return replaces
      await store.deleteLiveActivities(claim.id)
      if (sent.status === "token_rejected") await store.updateLiveActivityDevices({ id: device.id, push_to_start_token: null })
      return null
    })
  )
  return replaced.filter((token): token is string => !!token)
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
      url: activityUrl(group.id),
      content: contentOf(orderNumber(group.display_id), order, order.fulfilment.state as Exclude<FulfilmentState, "new" | "rejected">),
    }))
}
