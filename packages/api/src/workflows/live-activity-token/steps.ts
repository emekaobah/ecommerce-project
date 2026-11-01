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
  /** `subject_id`: the buyer's own order the activity's url names, when it names one. */
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
      await devices.updateLiveActivityDevices({ id: input.device_id, environment: input.environment, push_to_start_token: input.token })
      return new StepResponse({ token: input.token, catch_up: null as string | null, spare: false })
    }
    const held = await devices.listLiveActivities({ $or: [{ apple_id: input.activity_id }, { token: input.token }] })
    // A sign-out that never reached the server left the activity on the phone's old row.
    const stale = held.filter((activity) => activity.device_id !== input.device_id)
    if (stale.length) await devices.deleteLiveActivities(stale.map((activity) => activity.id))
    const known = held.find((activity) => activity.device_id === input.device_id)
    const reported = { apple_id: input.activity_id, token: input.token, environment: input.environment }
    let catch_up: string | null = null
    let spare = false
    if (known) {
      await devices.updateLiveActivities({ id: known.id, ...reported })
      // The server recorded its start, the phone named it, and only now can it be sent anything.
      if (!known.token) catch_up = known.id
    } else {
      const about = input.subject_id ? await devices.listLiveActivities({ device_id: input.device_id, kind: "buyer_shop_order", subject_id: input.subject_id }, { order: { started_at: "DESC" } }) : []
      const running = about.find((activity) => !activity.ended_at)
      // The row its start left, running or ended while it waited for this.
      const started = running && !running.apple_id ? running : !running ? about.find((activity) => !activity.apple_id && !activity.token) : undefined
      if (started) {
        await devices.updateLiveActivities({ id: started.id, ...reported })
        catch_up = started.id
      } else if (running) {
        spare = true
      } else {
        const created = await devices.createLiveActivities({
          device_id: input.device_id,
          kind: "buyer_shop_order",
          subject_id: input.subject_id ?? null,
          ...reported,
          started_at: new Date(),
        })
        // One the server has no row for: Apple's answer to its start got lost, say. It can still be followed.
        if (input.subject_id) catch_up = created.id
      }
    }
    await devices.updateLiveActivityDevices({ id: input.device_id, environment: input.environment, update_token_reported_at: new Date() })
    return new StepResponse({ token: input.token, catch_up, spare })
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
      return new StepResponse({ activity_id })
    }
    await devices.createLiveActivities({ device_id, kind: "buyer_shop_order", subject_id: order_id, apple_id: activity_id, environment, started_at: new Date() })
    return new StepResponse({ activity_id })
  }
)
