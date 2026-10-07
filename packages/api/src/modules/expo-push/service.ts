import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type { ProviderSendNotificationDTO, ProviderSendNotificationResultsDTO } from "@medusajs/framework/types"
import { expoError, expoPushApi, type ExpoPushOptions } from "./expo-api"

/**
 * Sends the `push` channel's notifications through Expo's push service (#27). A notification is
 * one device: `to` is its Expo push token, `content.subject` the title, `content.text` the body
 * and `data` what the app reads when the push is tapped. The notification's `external_id` is
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
    const ticket = await this.expo.send({
      to: notification.to,
      title: notification.content?.subject,
      body: notification.content?.text,
      data: notification.data ?? {},
      sound: "default",
      priority: "high",
    })
    if (ticket.status === "error") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Expo refused the push to ${notification.to}: ${expoError(ticket)}`
      )
    }
    return { id: ticket.id }
  }
}
