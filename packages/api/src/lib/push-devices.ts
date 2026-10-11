import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PUSH_CHANNEL } from "../modules/expo-push"
import { DEVICE_NOT_REGISTERED } from "../modules/expo-push/expo-api"
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
}

/**
 * Pushes to each device, one notification each, so a refusal is known to be that device's. A
 * device Expo says is no longer installed is forgotten; any other push Expo refuses is logged.
 * Either way the other devices get theirs.
 */
export async function pushToDevices(scope: Scope, devices: string[], push: DevicePush): Promise<void> {
  if (!devices.length) return
  const notifications = scope.resolve(Modules.NOTIFICATION)
  const sent = await Promise.allSettled(
    devices.map((to) =>
      notifications.createNotifications({
        to,
        channel: PUSH_CHANNEL,
        template: push.template,
        content: { subject: push.title, text: push.body },
        data: push.data,
        idempotency_key: push.idempotencyKey(to),
      })
    )
  )
  const gone: string[] = []
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  sent.forEach((result, i) => {
    if (result.status === "fulfilled") return
    const reason = errorMessage(result.reason)
    if (reason.includes(DEVICE_NOT_REGISTERED)) gone.push(devices[i])
    else logger.warn(`Pushing ${push.about} failed: ${reason}`)
  })
  await forgetPushDevices(scope, gone)
}
