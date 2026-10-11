import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type { ProviderSendNotificationDTO, ProviderSendNotificationResultsDTO } from "@medusajs/framework/types"

export const RESEND_API_URL = "https://api.resend.com"

export type ResendOptions = {
  apiKey: string
  /** The sender, e.g. `Oja <orders@example.com>`: an address on a domain verified in Resend. */
  from: string
  apiUrl?: string
}

/**
 * Sends the `email` channel's notifications through Resend (#5). The caller renders the email:
 * `content.subject`, `content.html` and `content.text` go out as they are, from the configured
 * sender. The notification's `external_id` is Resend's id for the email. An email Resend refuses
 * fails with Resend's message.
 */
export class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static readonly identifier = "resend"

  private readonly options: ResendOptions

  static validateOptions(options: Record<string, unknown>) {
    if (!options.apiKey || !options.from) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Resend needs an API key and a sender (RESEND_API_KEY, RESEND_FROM)")
    }
  }

  constructor(_: unknown, options: ResendOptions) {
    super()
    this.options = options
  }

  async send(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    const { apiKey, from, apiUrl = RESEND_API_URL } = this.options
    const res = await fetch(`${apiUrl}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: notification.to,
        subject: notification.content?.subject,
        html: notification.content?.html,
        text: notification.content?.text,
      }),
    })
    const reply = (await res.json().catch(() => null)) as { id?: string; message?: string } | null
    if (!res.ok || !reply?.id) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Resend refused the email to ${notification.to}: ${reply?.message ?? `HTTP ${res.status}`}`
      )
    }
    return { id: reply.id }
  }
}
