import type { CreateNotificationDTO, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { errorMessage } from "./errors"

type Scope = Pick<MedusaContainer, "resolve">

/** An email on the notification module's `email` channel; `about` names it in the log. */
export type Email = Omit<CreateNotificationDTO, "channel"> & { about: string }

/**
 * Sends an email. One that can't be sent (Resend refuses it, or it is down) is logged, not
 * thrown: the person still has the app, and whatever raised it carries on.
 */
export async function sendEmail(scope: Scope, { about, ...email }: Email): Promise<void> {
  try {
    await scope.resolve(Modules.NOTIFICATION).createNotifications({ ...email, channel: "email" })
  } catch (error) {
    scope.resolve(ContainerRegistrationKeys.LOGGER).warn(`Emailing ${about} failed: ${errorMessage(error)}`)
  }
}
