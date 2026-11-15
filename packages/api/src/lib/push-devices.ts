import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PUSH_CHANNEL } from "../modules/expo-push"
import { DEVICE_NOT_REGISTERED, type ExpoDataOnly, type ExpoPushAlert } from "../modules/expo-push/expo-api"
import { errorMessage } from "./errors"
import { PUSH_TOKEN_MODULE, type PushTokenModuleService } from "../modules/push-token"
import { forgetPushDevices } from "./push-receipts"

type Scope = Pick<MedusaContainer, "resolve">

/** One push, as each device is sent it (ADR 0008). */
export type DevicePush = {
  template: string
  title: string
  body: string
  /** What the app reads when the push is tapped: `url`, the screen it opens. */
  data: Record<string, unknown> & { url: string }
  /** The device's idempotency key: a device is told once per key, however often it is asked. */
  idempotencyKey: (device: string) => string
  /** What the push is about, for the log when Expo refuses it. */
  about: string
  /** How it rings, when not as every other push does (the new-order alarm, #71). */
  alert?: ExpoPushAlert
}

/** The devices a push didn't reach: `gone` have been forgotten, `failed` may work next time. */
export type PushOutcome = { gone: string[]; failed: string[] }

/** A push with nothing to show: only the app's background task sees it. */
export type DeviceDataPush = Omit<DevicePush, "title" | "body" | "alert"> & { ttl: number }

/**
 * Pushes to each device, one notification each, so a refusal is known to be that device's. A
 * device Expo says is no longer installed is forgotten; any other push Expo refuses is logged.
 * Either way the other devices get theirs.
 */
export async function pushToDevices(scope: Scope, devices: string[], push: DevicePush): Promise<void> {
  await sendToDevices(scope, devices, push, { subject: push.title, text: push.body }, push.alert ?? null)
}

/** `pushToDevices`, for a message the app handles itself (#148). Says how it went for whoever keeps track of what each device has. */
export async function pushDataToDevices(scope: Scope, devices: string[], push: DeviceDataPush): Promise<PushOutcome> {
  const dataOnly: ExpoDataOnly = { data_only: true, ttl: push.ttl }
  if (!devices.length) return { gone: [], failed: [] }
  // Each phone's message names its sign-in, so one that lands after its person signed out isn't drawn (#133).
  const rows = await scope.resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE).listPushTokens({ token: devices }, { select: ["token", "session"], take: null })
  const sessions = new Map(rows.map((row) => [row.token, row.session ?? null]))
  return sendToDevices(scope, devices, { ...push, dataFor: (to) => ({ ...push.data, session: sessions.get(to) ?? null }) }, {}, dataOnly)
}

async function sendToDevices(
  scope: Scope,
  devices: string[],
  push: Pick<DevicePush, "template" | "data" | "idempotencyKey" | "about"> & { dataFor?: (device: string) => Record<string, unknown> },
  content: { subject?: string; text?: string },
  providerData: ExpoPushAlert | ExpoDataOnly | null
): Promise<PushOutcome> {
  if (!devices.length) return { gone: [], failed: [] }
  const notifications = scope.resolve(Modules.NOTIFICATION)
  const sent = await Promise.allSettled(
    devices.map((to) =>
      notifications.createNotifications({
        to,
        channel: PUSH_CHANNEL,
        template: push.template,
        content,
        data: push.dataFor ? push.dataFor(to) : push.data,
        provider_data: providerData,
        idempotency_key: push.idempotencyKey(to),
      })
    )
  )
  const gone: string[] = []
  const failed: string[] = []
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  sent.forEach((result, i) => {
    if (result.status === "fulfilled") return
    const reason = errorMessage(result.reason)
    if (reason.includes(DEVICE_NOT_REGISTERED)) gone.push(devices[i])
    else {
      failed.push(devices[i])
      logger.warn(`Pushing ${push.about} failed: ${reason}`)
    }
  })
  await forgetPushDevices(scope, gone)
  await releaseFailedKeys(scope, failed.map((device) => push.idempotencyKey(device)))
  return { gone, failed }
}

/**
 * Lets a push Expo refused be sent again under its key. Medusa retries a key whose notification
 * failed, but sends it under a new id it never saves, so recording the send fails and the retry
 * counts as failed too: a caller trying again each minute would push the same message every
 * minute. Renaming the failed notification's key makes the next try a fresh notification.
 */
async function releaseFailedKeys(scope: Scope, keys: string[]): Promise<void> {
  if (!keys.length) return
  // `updateNotifications` is generated on Medusa's service, but its public type leaves it out.
  const notifications = scope.resolve(Modules.NOTIFICATION) as unknown as {
    listNotifications: (filters: Record<string, unknown>, config?: Record<string, unknown>) => Promise<{ id: string; idempotency_key: string | null; status: string }[]>
    updateNotifications: (data: { id: string; idempotency_key: string }[]) => Promise<unknown>
  }
  try {
    const held = await notifications.listNotifications({ idempotency_key: keys }, { select: ["id", "idempotency_key", "status"], take: null })
    const failed = held.filter((row) => row.status === "failure" && row.idempotency_key)
    if (failed.length) await notifications.updateNotifications(failed.map((row) => ({ id: row.id, idempotency_key: `${row.idempotency_key}#failed:${row.id}` })))
  } catch (error) {
    scope.resolve(ContainerRegistrationKeys.LOGGER).warn(`Freeing refused pushes to be sent again failed: ${errorMessage(error)}`)
  }
}
