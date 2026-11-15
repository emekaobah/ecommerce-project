import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type { ProviderSendNotificationDTO, ProviderSendNotificationResultsDTO } from "@medusajs/framework/types"
import { expoError, expoPushApi, type ExpoDataOnly, type ExpoPushAlert, type ExpoPushMessage, type ExpoPushOptions } from "./expo-api"

/**
 * Sends the `push` channel's notifications through Expo's push service (#27). A notification is
 * one device: `to` is its Expo push token, `content.subject` the title, `content.text` the body
 * and `data` what the app reads when the push is tapped. It plays the default sound unless its
 * `provider_data` is an `ExpoPushAlert` (the new-order alarm, #71). With an `ExpoDataOnly` it has
 * no title, body or sound, so only the app's background task sees it (#148). The notification's `external_id` is
 * Expo's ticket id, which its receipt is later asked for by. A push Expo refuses fails with
 * Expo's error code in the message (e.g. `DeviceNotRegistered`).
 */
export class ExpoPushNotificationProviderService extends AbstractNotificationProviderService {
  static readonly identifier = "expo-push"

  private readonly expo: ReturnType<typeof expoPushApi>

  constructor(_: unknown, options: ExpoPushOptions) {
    super()
    this.expo = expoPushApi(options)
  }

  async send(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    const ticket = await this.expo.send(this.messageOf(notification))
    if (ticket.status === "error") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Expo refused the push to ${notification.to}: ${expoError(ticket)}`
      )
    }
    return { id: ticket.id }
  }

  private messageOf(notification: ProviderSendNotificationDTO): ExpoPushMessage {
    const options = notification.provider_data as ExpoPushAlert | ExpoDataOnly | null | undefined
    const data = notification.data ?? {}
    if (options && "data_only" in options) return { to: notification.to, data, priority: "high", ttl: options.ttl }
    return {
      to: notification.to,
      title: notification.content?.subject,
      body: notification.content?.text,
      data,
      sound: options?.sound ?? "default",
      priority: "high",
      ...(options && { channelId: options.channelId, interruptionLevel: options.interruptionLevel }),
    }
  }
}
