import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type { ProviderSendNotificationDTO, ProviderSendNotificationResultsDTO } from "@medusajs/framework/types"

export const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2"

export type ExpoPushOptions = {
  /** Needed only once the Expo project turns on enhanced push security. */
  accessToken?: string
  apiUrl?: string
}

/** Expo's answer for one message: accepted with a ticket id, or refused (e.g. `DeviceNotRegistered`). */
type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } }

/**
 * Sends the `push` channel's notifications through Expo's push service (#27). A notification is
 * one device: `to` is its Expo push token, `content.subject` the title, `content.text` the body
 * and `data` what the app reads when the push is tapped.
 */
export class ExpoPushNotificationProviderService extends AbstractNotificationProviderService {
  static readonly identifier = "expo-push"

  private readonly apiUrl: string
  private readonly accessToken: string | undefined

  constructor(_: unknown, options: ExpoPushOptions) {
    super()
    this.apiUrl = options.apiUrl || EXPO_PUSH_API_URL
    this.accessToken = options.accessToken || undefined
  }

  async send(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    const message = {
      to: notification.to,
      title: notification.content?.subject,
      body: notification.content?.text,
      data: notification.data ?? {},
      sound: "default",
      priority: "high",
    }
    const res = await fetch(`${this.apiUrl}/push/send`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify([message]),
    })
    const reply = (await res.json().catch(() => null)) as { data?: ExpoTicket[]; errors?: { message?: string }[] } | null
    const ticket = reply?.data?.[0]
    if (!res.ok || !ticket) {
      const reason = reply?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Expo refused the push: ${reason}`)
    }
    if (ticket.status === "error") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Expo refused the push to ${notification.to}: ${ticket.details?.error ?? ticket.message}`
      )
    }
    return { id: ticket.id }
  }
}
