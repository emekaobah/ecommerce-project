import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PUSH_CHANNEL } from "../modules/expo-push"
import { DEVICE_NOT_REGISTERED, type ExpoDataOnly, type ExpoPushAlert } from "../modules/expo-push/expo-api"
import { errorMessage } from "./errors"
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
  return sendToDevices(scope, devices, push, {}, dataOnly)
}

async function sendToDevices(
  scope: Scope,
  devices: string[],
  push: Pick<DevicePush, "template" | "data" | "idempotencyKey" | "about">,
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
        data: push.data,
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
  return { gone, failed }
}
