import {
  appIdentity,
  dateIn,
  nearestAcceptDeadline,
  shopStatus,
  VENDOR_ACTIVITY_FACTORY,
  vendorActivityContent,
  type ShopHours,
  type VendorActivityContent,
} from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { LIVE_ACTIVITY_PUSH_MODULE, type LiveActivityPushModuleService } from "../modules/live-activity-push"
import { LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityTokenModuleService } from "../modules/live-activity-token"
import { SHIPBUBBLE_TIMEZONE } from "../modules/shipbubble"
import { errorMessage } from "./errors"
import { fulfilmentService } from "./order-fulfilment"
import { stageCounts } from "./order-stages"
import { shopHoursOf } from "./shop-hours"

// A shop's orders on the Lock Screen of phones that turned it on (#146): one activity per shop per
// phone, from the day's first new order until the shop closes or pauses. Pushes go straight to
// Apple (ADR 0017). The new-order push and alarm stay as they are, in `shop-push.ts`.

type Scope = Pick<MedusaContainer, "resolve">

const tokens = (scope: Scope) => scope.resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)
const sender = (scope: Scope) => scope.resolve<LiveActivityPushModuleService>(LIVE_ACTIVITY_PUSH_MODULE)

/** What tapping the activity opens: that shop's orders, acting for it. */
const activityUrl = (sellerId: string) => `${appIdentity("vendor").scheme}://shop-orders/${sellerId}`

const isOpen = (hours: ShopHours | null, now: Date) => !hours || shopStatus(hours, now).state === "open"

/** What the activity shows now: the tiles' counts and the nearest deadline. #147 sends this as it changes. */
export async function shopActivityContent(scope: Scope, sellerId: string, hours: ShopHours | null, now: Date): Promise<VendorActivityContent> {
  const { data } = await scope
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "seller", fields: ["name"], filters: { id: sellerId } })
  const waiting = await fulfilmentService(scope).listOrderFulfilments({ seller_id: sellerId, state: "new" }, { select: ["placed_at"], take: null })
  return vendorActivityContent({
    shop: (data[0] as { name?: string } | undefined)?.name ?? "",
    counts: await stageCounts(scope, sellerId),
    deadline: nearestAcceptDeadline(
      waiting.map((row) => new Date(row.placed_at).toISOString()),
      now,
      hours
    ),
  })
}

/** Phones that turned it on for the shop and can be started, whose member is still in the shop. */
async function phonesToStart(scope: Scope, sellerId: string) {
  const store = tokens(scope)
  const shops = await store.listLiveActivityShops({ seller_id: sellerId }, { select: ["device_id"], take: null })
  if (!shops.length) return []
  const { data } = await scope
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "seller_member", fields: ["member_id"], filters: { seller_id: sellerId } })
  return store.listLiveActivityDevices(
    {
      id: shops.map((shop) => shop.device_id),
      app: "vendor",
      actor_type: "member",
      actor_id: (data as unknown as { member_id: string }[]).map((member) => member.member_id),
      push_to_start_token: { $ne: null },
    },
    { take: null }
  )
}

type Running = { id: string; token: string | null; environment: "sandbox" | "production" }

/** Ends one activity. One Apple couldn't be told about stays running, for the job to try again. */
async function endActivity(scope: Scope, activity: Running, content: VendorActivityContent, now: Date) {
  if (activity.token) {
    const sent = await sender(scope).send({
      event: "end",
      app: "vendor",
      token: activity.token,
      environment: activity.environment,
      priority: 10,
      content: { factory: VENDOR_ACTIVITY_FACTORY, props: content },
      dismissAt: now,
    })
    if (sent.status === "failed") return
  }
  await tokens(scope).updateLiveActivities({ id: activity.id, ended_at: now })
}

/**
 * Starts the shop's activity on the phones that turned it on, if this order is the first new one
 * since it last ended, or today's first. A shop takes orders while closed, but its activity only
 * runs in open hours, where its wall-clock countdown matches the accept clock.
 */
export async function startShopActivity(scope: Scope, orderId: string, now = new Date()): Promise<void> {
  const [row] = await fulfilmentService(scope).listOrderFulfilments({ order_id: orderId }, { select: ["seller_id"] })
  const sellerId = row?.seller_id
  if (!sellerId) return
  const phones = await phonesToStart(scope, sellerId)
  if (!phones.length) return
  const hours = (await shopHoursOf(scope, [sellerId], now)).get(sellerId) ?? null
  if (!isOpen(hours, now)) return

  const store = tokens(scope)
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const content = await shopActivityContent(scope, sellerId, hours, now)
  const timeZone = hours?.time_zone ?? SHIPBUBBLE_TIMEZONE
  const today = dateIn(now.getTime(), timeZone)

  await Promise.all(
    phones.map(async (phone) => {
      const [running] = await store.listLiveActivities({ device_id: phone.id, kind: "vendor_shop", subject_id: sellerId, ended_at: null })
      if (running) {
        if (dateIn(new Date(running.started_at).getTime(), timeZone) === today) return
        await endActivity(scope, running, content, now)
      }
      let claim: { id: string }
      try {
        claim = await store.createLiveActivities({
          device_id: phone.id,
          kind: "vendor_shop",
          subject_id: sellerId,
          environment: phone.environment,
          started_at: now,
        })
      } catch (error) {
        // Another order of the same moment got there first.
        logger.warn(`Recording shop ${sellerId}'s Live Activity failed: ${errorMessage(error)}`)
        return
      }
      const sent = await sender(scope).send({
        event: "start",
        app: "vendor",
        token: phone.push_to_start_token!,
        environment: phone.environment,
        priority: 10,
        content: { factory: VENDOR_ACTIVITY_FACTORY, props: content },
        // Apple requires an alert. It has no sound, so the new order's alarm is what's heard.
        alert: { title: content.shop, body: "Today's orders are on your Lock Screen." },
        url: activityUrl(sellerId),
      })
      if (sent.status === "sent") return
      await store.deleteLiveActivities(claim.id)
      if (sent.status === "token_rejected") await store.updateLiveActivityDevices({ id: phone.id, push_to_start_token: null })
    })
  )
}

/** Ends the shop's activity on every phone running it. */
export async function endShopActivity(scope: Scope, sellerId: string, now = new Date()): Promise<void> {
  const running = await tokens(scope).listLiveActivities({ kind: "vendor_shop", subject_id: sellerId, ended_at: null }, { take: null })
  if (!running.length) return
  const hours = (await shopHoursOf(scope, [sellerId], now)).get(sellerId) ?? null
  const content = await shopActivityContent(scope, sellerId, hours, now)
  await Promise.all(running.map((activity) => endActivity(scope, activity, content, now)))
}

/** Ends the activities of shops not open now: closed by their hours, or a pause that couldn't be told at once. */
export async function endActivitiesOfClosedShops(scope: Scope, now = new Date()): Promise<void> {
  const running = await tokens(scope).listLiveActivities(
    { kind: "vendor_shop", subject_id: { $ne: null }, ended_at: null },
    { select: ["subject_id"], take: null }
  )
  const sellerIds = [...new Set(running.map((activity) => activity.subject_id!))]
  if (!sellerIds.length) return
  const hours = await shopHoursOf(scope, sellerIds, now)
  const closed = sellerIds.filter((sellerId) => !isOpen(hours.get(sellerId) ?? null, now))
  await Promise.all(closed.map((sellerId) => endShopActivity(scope, sellerId, now)))
}
