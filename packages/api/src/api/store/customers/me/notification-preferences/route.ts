import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { endBuyerActivities } from "../../../../../lib/buyer-live-activity"
import { errorMessage } from "../../../../../lib/errors"
import {
  notificationPreferencesOf,
  setNotificationPreferences,
  type NotificationPreferences,
} from "../../../../../lib/notification-preferences"
import type { StoreUpdateNotificationPreferencesType } from "./validators"

type NotificationPreferencesResponse = { notification_preferences: NotificationPreferences }

// The signed-in buyer's notification settings (#138); Medusa signs in `/store/customers/me*`, so
// a buyer only ever reads and changes their own.

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<NotificationPreferencesResponse>) => {
  res.json({ notification_preferences: await notificationPreferencesOf(req.scope, req.auth_context.actor_id) })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<StoreUpdateNotificationPreferencesType>,
  res: MedusaResponse<NotificationPreferencesResponse>
) => {
  const customerId = req.auth_context.actor_id
  const saved = await setNotificationPreferences(req.scope, customerId, req.validatedBody)
  if (req.validatedBody.orders_on_lock_screen === false) {
    // The switch is saved, so it mustn't flip back over this: the order's next update ends what's left.
    await endBuyerActivities(req.scope, customerId).catch((error) =>
      req.scope.resolve(ContainerRegistrationKeys.LOGGER).warn(`Ending the Live Activities of ${customerId} failed: ${errorMessage(error)}`)
    )
  }
  res.json({ notification_preferences: saved })
}
