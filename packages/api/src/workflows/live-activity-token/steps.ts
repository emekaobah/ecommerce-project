import type { MedusaContainer } from "@medusajs/framework/types"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { randomBytes } from "node:crypto"
import { hashDeviceKey, LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityTokenModuleService } from "../../modules/live-activity-token"

type Scope = Pick<MedusaContainer, "resolve">
type Environment = "sandbox" | "production"
type Actor = { actor_type: "customer" | "member"; actor_id: string }

const service = (scope: Scope) => scope.resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)

const DEVICE_FIELDS = ["id", "app", "actor_type", "actor_id", "key_hash", "push_token", "push_to_start_token", "environment", "update_token_reported_at"] as const
const ACTIVITY_FIELDS = ["id", "device_id", "kind", "subject_id", "apple_id", "token", "sent_content", "sent_at", "end_content", "end_dismiss_at", "environment", "started_at", "ended_at"] as const
const SHOP_FIELDS = ["id", "device_id", "seller_id", "closed_seen_at"] as const

/** A row's own columns, as they stood: what a step that changed or deleted it puts back. */
const saved = <T extends object, K extends keyof T>(row: T, fields: readonly K[]) => Object.fromEntries(fields.map((field) => [field, row[field]])) as Pick<T, K>

export type RegisterDeviceInput = Actor & { app: "buyer" | "vendor"; key?: string; environment: Environment; push_token?: string }

type SavedDevice = Pick<Awaited<ReturnType<LiveActivityTokenModuleService["retrieveLiveActivityDevice"]>>, (typeof DEVICE_FIELDS)[number]>
type RegisterUndo = { unlinked: { id: string; push_token: string | null }[]; previous?: SavedDevice; created?: string }

/**
 * Gives the phone its key, or keeps the one it has, moving the phone to whoever is signed in on
 * it now. Its Expo token moves here from a row an unreachable sign-out left behind.
 */
export const registerLiveActivityDeviceStep = createStep(
  "register-live-activity-device",
  async ({ key, push_token, ...device }: RegisterDeviceInput, { container }) => {
    const devices = service(container)
    const [held] = key ? await devices.listLiveActivityDevices({ key_hash: hashDeviceKey(key) }) : []
    const stale = push_token ? (await devices.listLiveActivityDevices({ push_token })).filter((other) => other.id !== held?.id) : []
    const unlinked = stale.map(({ id, push_token }) => ({ id, push_token }))
    if (stale.length) await devices.updateLiveActivityDevices(stale.map(({ id }) => ({ id, push_token: null })))
    const linked = push_token ? { push_token } : {}
    if (held) {
      await devices.updateLiveActivityDevices({ id: held.id, ...device, ...linked })
      const undo: RegisterUndo = { unlinked, previous: saved(held, DEVICE_FIELDS) }
      return new StepResponse({ key: key! }, undo)
    }
    const issued = randomBytes(32).toString("base64url")
    const created = await devices.createLiveActivityDevices({ ...device, ...linked, key_hash: hashDeviceKey(issued) })
    const undo: RegisterUndo = { unlinked, created: created.id }
    return new StepResponse({ key: issued }, undo)
  },
  async (undo, { container }) => {
    if (!undo) return
    const devices = service(container)
    if (undo.created) await devices.deleteLiveActivityDevices(undo.created)
    if (undo.previous) await devices.updateLiveActivityDevices(undo.previous)
    if (undo.unlinked.length) await devices.updateLiveActivityDevices(undo.unlinked)
  }
)

/** Forgets the phone and its activities, if it is still this person's: someone else may have signed in on it since. */
export const removeLiveActivityDeviceStep = createStep(
  "remove-live-activity-device",
  async ({ key, ...actor }: Actor & { key: string }, { container }) => {
    const devices = service(container)
    const owned = await devices.listLiveActivityDevices({ key_hash: hashDeviceKey(key), ...actor }, { relations: ["activities", "shops"] })
    if (owned.length) await devices.deleteLiveActivityDevices(owned.map((d) => d.id))
    return new StepResponse(
      { removed: owned.length > 0 },
      owned.map((device) => ({
        device: saved(device, DEVICE_FIELDS),
        activities: device.activities.map((activity) => saved(activity, ACTIVITY_FIELDS)),
        shops: device.shops.map((shop) => saved(shop, SHOP_FIELDS)),
      }))
    )
  },
  async (removed, { container }) => {
    if (!removed?.length) return
    const devices = service(container)
    await devices.createLiveActivityDevices(removed.map(({ device }) => device))
    await devices.createLiveActivities(removed.flatMap(({ activities }) => activities))
    await devices.createLiveActivityShops(removed.flatMap(({ shops }) => shops))
  }
)

/** A buyer's Android phone signed out, which cleared what it showed: those orders don't come back when it signs in again. */
export const forgetBuyerLiveUpdatesStep = createStep(
  "forget-buyer-live-updates",
  async ({ push_token, customer_id }: { push_token: string; customer_id: string }, { container }) => {
    const devices = service(container)
    const rows = await devices.listBuyerLiveUpdates({ push_token, customer_id }, { take: null })
    if (rows.length) await devices.deleteBuyerLiveUpdates(rows.map(({ id }) => id))
    return new StepResponse({ forgotten: rows.length }, rows.map(({ push_token, customer_id, order_id, ended_at }) => ({ push_token, customer_id, order_id, ended_at })))
  },
  async (deleted, { container }) => {
    if (deleted?.length) await service(container).createBuyerLiveUpdates(deleted)
  }
)

type SavedActivity = Pick<Awaited<ReturnType<LiveActivityTokenModuleService["retrieveLiveActivity"]>>, (typeof ACTIVITY_FIELDS)[number]>
type ReportUndo = {
  device: SavedDevice
  /** Other phones its push-to-start token moved from. */
  holders: { id: string; push_to_start_token: string | null }[]
  activities: SavedActivity[]
  deleted: SavedActivity[]
  created?: string
}

export type ReportTokenInput = { device_id: string; environment: Environment; token: string } & (
  | { kind: "push_to_start" }
  /** `subject_id`: what the activity's url names, the buyer's own order or the member's own shop, when it names one. */
  | { kind: "activity"; activity_id: string; subject_id?: string }
)

/** Takes a token from the phone, repeats included; a token another row holds has moved to this phone. */
export const reportLiveActivityTokenStep = createStep(
  "report-live-activity-token",
  async (input: ReportTokenInput, { container }) => {
    const devices = service(container)
    if (input.kind === "push_to_start") {
      const holders = await devices.listLiveActivityDevices({ push_to_start_token: input.token })
      const others = holders.filter((other) => other.id !== input.device_id)
      if (others.length) await devices.updateLiveActivityDevices(others.map(({ id }) => ({ id, push_to_start_token: null })))
      const before = await devices.retrieveLiveActivityDevice(input.device_id)
      await devices.updateLiveActivityDevices({ id: input.device_id, environment: input.environment, push_to_start_token: input.token })
      const undo: ReportUndo = { device: saved(before, DEVICE_FIELDS), holders: others.map(({ id, push_to_start_token }) => ({ id, push_to_start_token })), activities: [], deleted: [] }
      return new StepResponse({ token: input.token, catch_up: null as string | null, spare: false }, undo)
    }
    const held = await devices.listLiveActivities({ $or: [{ apple_id: input.activity_id }, { token: input.token }] })
    // A sign-out that never reached the server left the activity on the phone's old row.
    const stale = held.filter((activity) => activity.device_id !== input.device_id)
    if (stale.length) await devices.deleteLiveActivities(stale.map((activity) => activity.id))
    const known = held.find((activity) => activity.device_id === input.device_id)
    const device = await devices.retrieveLiveActivityDevice(input.device_id)
    const { app } = device
    const kind = app === "vendor" ? "vendor_shop" : "buyer_shop_order"
    const reported = { apple_id: input.activity_id, token: input.token, environment: input.environment }
    let catch_up: string | null = null
    let spare = false
    const undo: ReportUndo = { device: saved(device, DEVICE_FIELDS), holders: [], activities: [], deleted: stale.map((activity) => saved(activity, ACTIVITY_FIELDS)) }
    if (known) {
      undo.activities.push(saved(known, ACTIVITY_FIELDS))
      await devices.updateLiveActivities({ id: known.id, ...reported })
      // The server recorded its start, the phone named it, and only now can it be sent anything.
      if (!known.token) catch_up = known.id
    } else {
      const about = input.subject_id ? await devices.listLiveActivities({ device_id: input.device_id, kind, subject_id: input.subject_id }, { order: { started_at: "DESC" } }) : []
      const running = about.find((activity) => !activity.ended_at)
      // The row its start left, running or ended while it waited for this.
      const started = running && !running.apple_id ? running : !running ? about.find((activity) => !activity.apple_id && !activity.token) : undefined
      if (started) {
        undo.activities.push(saved(started, ACTIVITY_FIELDS))
        await devices.updateLiveActivities({ id: started.id, ...reported })
        catch_up = started.id
      } else if (running) {
        spare = true
      } else {
        const created = await devices.createLiveActivities({
          device_id: input.device_id,
          kind,
          subject_id: input.subject_id ?? null,
          ...reported,
          started_at: new Date(),
        })
        // One the server has no row for: Apple's answer to its start got lost, say. It can still be followed.
        undo.created = created.id
        if (input.subject_id) catch_up = created.id
      }
    }
    await devices.updateLiveActivityDevices({ id: input.device_id, environment: input.environment, update_token_reported_at: new Date() })
    return new StepResponse({ token: input.token, catch_up, spare }, undo)
  },
  async (undo, { container }) => {
    if (!undo) return
    const devices = service(container)
    if (undo.created) await devices.deleteLiveActivities(undo.created)
    if (undo.activities.length) await devices.updateLiveActivities(undo.activities)
    if (undo.deleted.length) await devices.createLiveActivities(undo.deleted)
    if (undo.holders.length) await devices.updateLiveActivityDevices(undo.holders)
    await devices.updateLiveActivityDevices(undo.device)
  }
)

export type RecordStartInput = { device_id: string; order_id: string; activity_id: string; environment: Environment }

/** The phone started an activity itself (iOS below 17.2), so the server knows which order it is for. */
export const recordLiveActivityStartedStep = createStep(
  "record-live-activity-started",
  async ({ device_id, order_id, activity_id, environment }: RecordStartInput, { container }) => {
    const devices = service(container)
    const [running] = await devices.listLiveActivities({ device_id, kind: "buyer_shop_order", subject_id: order_id, ended_at: null })
    if (running) {
      await devices.updateLiveActivities({ id: running.id, apple_id: activity_id, environment })
      const undo: { previous?: { id: string; apple_id: string | null; environment: Environment }; created?: string } = { previous: { id: running.id, apple_id: running.apple_id, environment: running.environment } }
      return new StepResponse({ activity_id }, undo)
    }
    const created = await devices.createLiveActivities({ device_id, kind: "buyer_shop_order", subject_id: order_id, apple_id: activity_id, environment, started_at: new Date() })
    const undo: { previous?: { id: string; apple_id: string | null; environment: Environment }; created?: string } = { created: created.id }
    return new StepResponse({ activity_id }, undo)
  },
  async (undo, { container }) => {
    if (undo?.created) await service(container).deleteLiveActivities(undo.created)
    if (undo?.previous) await service(container).updateLiveActivities(undo.previous)
  }
)

export type SetShopInput = { device_id: string; seller_id: string; on: boolean }

/** Turns "Orders on Lock Screen" on or off for one shop on one phone. */
export const setLiveActivityShopStep = createStep(
  "set-live-activity-shop",
  async ({ device_id, seller_id, on }: SetShopInput, { container }) => {
    const devices = service(container)
    const held = await devices.listLiveActivityShops({ device_id, seller_id })
    const created = on && !held.length ? await devices.createLiveActivityShops({ device_id, seller_id }) : null
    const removed = !on ? held.map((shop) => saved(shop, SHOP_FIELDS)) : []
    if (removed.length) await devices.deleteLiveActivityShops(removed.map(({ id }) => id))
    return new StepResponse({ on }, { created: created?.id ?? null, removed })
  },
  async (undo, { container }) => {
    if (undo?.created) await service(container).deleteLiveActivityShops(undo.created)
    if (undo?.removed.length) await service(container).createLiveActivityShops(undo.removed)
  }
)
