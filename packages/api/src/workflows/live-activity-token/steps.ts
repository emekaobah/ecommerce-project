import type { MedusaContainer } from "@medusajs/framework/types"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { createHash, randomBytes } from "node:crypto"
import { LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityTokenModuleService } from "../../modules/live-activity-token"

type Scope = Pick<MedusaContainer, "resolve">
type Environment = "sandbox" | "production"
type Actor = { actor_type: "customer" | "member"; actor_id: string }

const service = (scope: Scope) => scope.resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)

export const hashDeviceKey = (key: string) => createHash("sha256").update(key).digest("hex")

export type RegisterDeviceInput = Actor & { app: "buyer" | "vendor"; key?: string; environment: Environment; push_token?: string }

/**
 * Gives the phone its key, or keeps the one it has, moving the phone to whoever is signed in on
 * it now. Its Expo token moves here from a row an unreachable sign-out left behind.
 */
export const registerLiveActivityDeviceStep = createStep(
  "register-live-activity-device",
  async ({ key, push_token, ...device }: RegisterDeviceInput, { container }) => {
    const devices = service(container)
    const [held] = key ? await devices.listLiveActivityDevices({ key_hash: hashDeviceKey(key) }) : []
    if (push_token) {
      const others = await devices.listLiveActivityDevices({ push_token })
      const stale = others.filter((other) => other.id !== held?.id)
      if (stale.length) await devices.updateLiveActivityDevices(stale.map(({ id }) => ({ id, push_token: null })))
    }
    const linked = push_token ? { push_token } : {}
    if (held) {
      await devices.updateLiveActivityDevices({ id: held.id, ...device, ...linked })
      return new StepResponse({ key: key! })
    }
    const issued = randomBytes(32).toString("base64url")
    await devices.createLiveActivityDevices({ ...device, ...linked, key_hash: hashDeviceKey(issued) })
    return new StepResponse({ key: issued })
  }
)

/** Forgets the phone and its activities, if it is still this person's: someone else may have signed in on it since. */
export const removeLiveActivityDeviceStep = createStep(
  "remove-live-activity-device",
  async ({ key, ...actor }: Actor & { key: string }, { container }) => {
    const devices = service(container)
    const owned = await devices.listLiveActivityDevices({ key_hash: hashDeviceKey(key), ...actor })
    if (owned.length) await devices.deleteLiveActivityDevices(owned.map((d) => d.id))
    return new StepResponse({ removed: owned.length > 0 })
  }
)

export type ReportTokenInput = { device_id: string; environment: Environment; token: string } & (
  | { kind: "push_to_start" }
  | { kind: "activity"; activity_id: string }
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
      await devices.updateLiveActivityDevices({ id: input.device_id, environment: input.environment, push_to_start_token: input.token })
      return new StepResponse({ token: input.token })
    }
    const held = await devices.listLiveActivities({ $or: [{ apple_id: input.activity_id }, { token: input.token }] })
    // A sign-out that never reached the server left the activity on the phone's old row.
    const stale = held.filter((activity) => activity.device_id !== input.device_id)
    if (stale.length) await devices.deleteLiveActivities(stale.map((activity) => activity.id))
    const known = held.find((activity) => activity.device_id === input.device_id)
    const { app } = await devices.retrieveLiveActivityDevice(input.device_id)
    if (known) await devices.updateLiveActivities({ id: known.id, apple_id: input.activity_id, token: input.token, environment: input.environment })
    else if (app === "vendor") await recordShopActivityToken(devices, input)
    else {
      await devices.createLiveActivities({
        device_id: input.device_id,
        kind: "buyer_shop_order",
        apple_id: input.activity_id,
        token: input.token,
        environment: input.environment,
        started_at: new Date(),
      })
    }
    await devices.updateLiveActivityDevices({ id: input.device_id, environment: input.environment, update_token_reported_at: new Date() })
    return new StepResponse({ token: input.token })
  }
)

/**
 * The phone can't say which shop a push-started activity is for (ADR 0018). If it's waiting on
 * just one, that's the one. If it's waiting on several it isn't guessed: a wrong guess would end
 * one shop's activity when another closes, so this one runs out by itself.
 */
async function recordShopActivityToken(devices: LiveActivityTokenModuleService, input: ReportTokenInput & { kind: "activity" }) {
  const { device_id, activity_id, token, environment } = input
  const waiting = await devices.listLiveActivities({ device_id, kind: "vendor_shop", ended_at: null, token: null })
  if (waiting.length === 1) {
    await devices.updateLiveActivities({ id: waiting[0].id, apple_id: activity_id, token, environment })
    return
  }
  await devices.createLiveActivities({ device_id, kind: "vendor_shop", apple_id: activity_id, token, environment, started_at: new Date() })
}

export type RecordStartInput = { device_id: string; order_id: string; activity_id: string; environment: Environment }

/** The phone started an activity itself (iOS below 17.2), so the server knows which order it is for. */
export const recordLiveActivityStartedStep = createStep(
  "record-live-activity-started",
  async ({ device_id, order_id, activity_id, environment }: RecordStartInput, { container }) => {
    const devices = service(container)
    const [running] = await devices.listLiveActivities({ device_id, kind: "buyer_shop_order", subject_id: order_id, ended_at: null })
    if (running) {
      await devices.updateLiveActivities({ id: running.id, apple_id: activity_id, environment })
      return new StepResponse({ activity_id })
    }
    await devices.createLiveActivities({ device_id, kind: "buyer_shop_order", subject_id: order_id, apple_id: activity_id, environment, started_at: new Date() })
    return new StepResponse({ activity_id })
  }
)

export type SetShopInput = { device_id: string; seller_id: string; on: boolean }

/** Turns "Orders on Lock Screen" on or off for one shop on one phone. */
export const setLiveActivityShopStep = createStep(
  "set-live-activity-shop",
  async ({ device_id, seller_id, on }: SetShopInput, { container }) => {
    const devices = service(container)
    const held = await devices.listLiveActivityShops({ device_id, seller_id })
    if (on && !held.length) await devices.createLiveActivityShops({ device_id, seller_id })
    if (!on && held.length) await devices.deleteLiveActivityShops(held.map(({ id }) => id))
    return new StepResponse({ on })
  }
)
