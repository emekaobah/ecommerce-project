import {
  appIdentity,
  dateIn,
  nearestAcceptDeadline,
  shopStatus,
  VENDOR_ACTIVITY_FACTORY,
  vendorActivityAlert,
  vendorActivityContent,
  vendorActivityUpdateDue,
  type ShopHours,
  type VendorActivityContent,
  type VendorActivityMoment,
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
//
// Staying current (#147) needs no memory but the database: each activity records what Apple last
// accepted for it, and the minute job (`keepShopActivitiesCurrent`) sends whatever differs from
// what's true now. A change costs nothing until then, so a burst of them is one update, and a
// restart loses nothing. `shopUpdatesDue` decides; `sendUpdate` is the only part that knows Apple.

type Scope = Pick<MedusaContainer, "resolve">

const tokens = (scope: Scope) => scope.resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)
const sender = (scope: Scope) => scope.resolve<LiveActivityPushModuleService>(LIVE_ACTIVITY_PUSH_MODULE)

/** What tapping the activity opens: that shop's orders, acting for it. */
const activityUrl = (sellerId: string) => `${appIdentity("vendor").scheme}://shop-orders/${sellerId}`

const isOpen = (hours: ShopHours | null, now: Date) => !hours || shopStatus(hours, now).state === "open"

/** What the activity shows now: the tiles' counts and the nearest deadline. */
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

/** Phones that have it on for the shop, whose member is still in the shop. */
async function phonesOfShop(scope: Scope, sellerId: string) {
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
    },
    { take: null }
  )
}

type Running = {
  id: string
  device_id: string
  subject_id: string | null
  token: string | null
  environment: "sandbox" | "production"
  sent_content: Record<string, unknown> | null
  sent_at: Date | string | null
}

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

/** Sends an update and records what Apple accepted. One it says is gone is over; a failed push is tried by the next batch. */
async function sendUpdate(scope: Scope, activity: Running & { token: string }, content: VendorActivityContent, priority: 5 | 10, now: Date, alert?: { title: string; body: string }) {
  const sent = await sender(scope).send({
    event: "update",
    app: "vendor",
    token: activity.token,
    environment: activity.environment,
    priority,
    content: { factory: VENDOR_ACTIVITY_FACTORY, props: content },
    alert,
  })
  if (sent.status === "sent") await tokens(scope).updateLiveActivities({ id: activity.id, sent_content: content, sent_at: now })
  if (sent.status === "token_rejected") await tokens(scope).updateLiveActivities({ id: activity.id, ended_at: now })
}

/** The shop's running activities that have a token to push to. A phone that hasn't reported one yet catches up in a batch. */
const updatable = async (scope: Scope, filter: { subject_id: string | { $ne: null } }) =>
  (await tokens(scope).listLiveActivities({ kind: "vendor_shop", ended_at: null, token: { $ne: null }, ...filter }, { take: null })) as unknown as (Running & { token: string })[]

/** Starts the activity on these phones, unless it's already running since today. */
async function startOnPhones(scope: Scope, sellerId: string, phones: Awaited<ReturnType<typeof phonesOfShop>>, hours: ShopHours | null, content: VendorActivityContent, now: Date) {
  const store = tokens(scope)
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const timeZone = hours?.time_zone ?? SHIPBUBBLE_TIMEZONE
  const today = dateIn(now.getTime(), timeZone)

  await Promise.all(
    phones
      .filter((phone) => phone.push_to_start_token)
      .map(async (phone) => {
        const [running] = await store.listLiveActivities({ device_id: phone.id, kind: "vendor_shop", subject_id: sellerId, ended_at: null })
        if (running) {
          if (dateIn(new Date(running.started_at).getTime(), timeZone) === today) return
          await endActivity(scope, running as unknown as Running, content, now)
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
        if (sent.status === "sent") {
          await store.updateLiveActivities({ id: claim.id, sent_content: content, sent_at: now })
          return
        }
        await store.deleteLiveActivities(claim.id)
        if (sent.status === "token_rejected") await store.updateLiveActivityDevices({ id: phone.id, push_to_start_token: null })
      })
  )
}

/**
 * A new order: starts the shop's activity on the phones that turned it on, if this order is the
 * first new one since it last ended, or today's first, and alerts the phones already running it.
 * A shop takes orders while closed, but its activity only runs in open hours: such an order shows
 * when the shop opens (`noticeShopsOpeningAndClosing`).
 */
export async function startShopActivity(scope: Scope, orderId: string, now = new Date()): Promise<void> {
  const [row] = await fulfilmentService(scope).listOrderFulfilments({ order_id: orderId }, { select: ["seller_id"] })
  const sellerId = row?.seller_id
  if (!sellerId) return
  const phones = await phonesOfShop(scope, sellerId)
  if (!phones.length) return
  const hours = (await shopHoursOf(scope, [sellerId], now)).get(sellerId) ?? null
  if (!isOpen(hours, now)) return

  const content = await shopActivityContent(scope, sellerId, hours, now)
  await startOnPhones(scope, sellerId, phones, hours, content, now)
  // After the starts: one just started has no token yet, and had its own alert.
  await alertRunning(scope, sellerId, phones, "new_order", content, now)
}

/** Updates at once, with an alert, the phones running the activity that may still have it. */
async function alertRunning(scope: Scope, sellerId: string, phones: { id: string }[], moment: VendorActivityMoment, content: VendorActivityContent, now: Date) {
  const allowed = new Set(phones.map((phone) => phone.id))
  const running = (await updatable(scope, { subject_id: sellerId })).filter((activity) => allowed.has(activity.device_id))
  const alert = vendorActivityAlert(moment, content)
  await Promise.all(running.map((activity) => sendUpdate(scope, activity, content, 10, now, alert)))
}

/** An order entered its last two hours to accept (the reminder's moment, once per order): phones running the activity are alerted at once. */
export async function alertDeadlineNear(scope: Scope, orderId: string, now: Date): Promise<void> {
  const [row] = await fulfilmentService(scope).listOrderFulfilments({ order_id: orderId }, { select: ["seller_id"] })
  const sellerId = row?.seller_id
  if (!sellerId) return
  const phones = await phonesOfShop(scope, sellerId)
  if (!phones.length) return
  const hours = (await shopHoursOf(scope, [sellerId], now)).get(sellerId) ?? null
  await alertRunning(scope, sellerId, phones, "deadline_near", await shopActivityContent(scope, sellerId, hours, now), now)
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

/**
 * Notices shops opening, for those phones that have the switch on: a shop seen closed is marked,
 * and once it's seen open with orders waiting, the activity starts, carrying the deadline as it
 * stands. An activity ends when a shop closes (or pauses), so that's how the deadline gets
 * resent at opening. A phone that turned the switch on while the shop was open isn't marked, and
 * waits for a new order. The marks are in the database, so an opening during a restart is still seen.
 */
export async function noticeShopsOpeningAndClosing(scope: Scope, now = new Date(), sellerId?: string): Promise<void> {
  const store = tokens(scope)
  const shops = await store.listLiveActivityShops(sellerId ? { seller_id: sellerId } : {}, { select: ["id", "seller_id", "device_id", "closed_seen_at"], take: null })
  if (!shops.length) return
  const hours = await shopHoursOf(scope, shops.map((shop) => shop.seller_id), now)
  const open = (shop: { seller_id: string }) => isOpen(hours.get(shop.seller_id) ?? null, now)

  const closing = shops.filter((shop) => !open(shop) && !shop.closed_seen_at)
  if (closing.length) await store.updateLiveActivityShops(closing.map(({ id }) => ({ id, closed_seen_at: now })))

  const opened = shops.filter((shop) => open(shop) && shop.closed_seen_at)
  if (!opened.length) return
  await store.updateLiveActivityShops(opened.map(({ id }) => ({ id, closed_seen_at: null })))
  await Promise.all(
    [...new Set(opened.map((shop) => shop.seller_id))].map(async (id) => {
      const shopHours = hours.get(id) ?? null
      const content = await shopActivityContent(scope, id, shopHours, now)
      if (!content.counts.new) return
      const phones = new Set(opened.filter((shop) => shop.seller_id === id).map((shop) => shop.device_id))
      await startOnPhones(scope, id, (await phonesOfShop(scope, id)).filter((phone) => phones.has(phone.id)), shopHours, content, now)
    })
  )
}

/**
 * The batched updates due now, without sending anything: each running activity on an open shop
 * whose phone last got something other than what's true now, plus those whose phone may no longer
 * have it (switch off, or changed hands), which end.
 */
export async function shopUpdatesDue(scope: Scope, now: Date) {
  const running = await updatable(scope, { subject_id: { $ne: null } })
  const sellerIds = [...new Set(running.map((activity) => activity.subject_id!))]
  const hours = await shopHoursOf(scope, sellerIds, now)
  return Promise.all(
    sellerIds
      .filter((id) => isOpen(hours.get(id) ?? null, now))
      .map(async (id) => {
        const [content, phones] = await Promise.all([shopActivityContent(scope, id, hours.get(id) ?? null, now), phonesOfShop(scope, id)])
        const allowed = new Set(phones.map((phone) => phone.id))
        const here = running.filter((activity) => activity.subject_id === id)
        return {
          content,
          end: here.filter((activity) => !allowed.has(activity.device_id)),
          update: here.filter((activity) => allowed.has(activity.device_id) && vendorActivityUpdateDue(lastSent(activity), content, now)),
        }
      })
  )
}

const lastSent = ({ sent_content, sent_at }: Running) =>
  sent_content && sent_at ? { content: sent_content as unknown as VendorActivityContent, at: new Date(sent_at) } : null

/** Sends the batch: quiet, at priority 5, so a busy shop stays inside Apple's budget. */
export async function sendBatchedShopUpdates(scope: Scope, now = new Date()): Promise<void> {
  const shops = await shopUpdatesDue(scope, now)
  await Promise.all(
    shops.flatMap(({ content, end, update }) => [
      ...end.map((activity) => endActivity(scope, activity, content, now)),
      ...update.map((activity) => sendUpdate(scope, activity, content, 5, now)),
    ])
  )
}

/** The minute job: everything that keeps shops' activities true without an event to say so. */
export async function keepShopActivitiesCurrent(scope: Scope, now = new Date()): Promise<void> {
  await endActivitiesOfClosedShops(scope, now)
  await noticeShopsOpeningAndClosing(scope, now)
  await sendBatchedShopUpdates(scope, now)
}
