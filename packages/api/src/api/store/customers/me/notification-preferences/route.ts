import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
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
  res.json({ notification_preferences: await setNotificationPreferences(req.scope, req.auth_context.actor_id, req.validatedBody) })
}
