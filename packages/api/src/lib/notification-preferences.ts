import type { MedusaContainer } from "@medusajs/framework/types"
import { NOTIFICATION_PREFERENCE_MODULE, type NotificationPreferenceModuleService } from "../modules/notification-preference"
import { setNotificationPreferencesWorkflow } from "../workflows/notification-preferences/set-notification-preferences"

// A buyer's notification settings (#138), kept on the server so they hold on any phone the buyer
// signs in on. Read them before sending a notification a buyer can turn off; order notifications
// have no setting and always go. #139's unsubscribe link turns the cart reminder email off with
// `setNotificationPreferences`.

type Scope = Pick<MedusaContainer, "resolve">

/** Every setting a buyer has; each is on unless they turned it off. */
export const NOTIFICATION_PREFERENCE_KEYS = ["cart_reminder_push", "cart_reminder_email", "orders_on_lock_screen"] as const
export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number]

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>
/** Some of a buyer's settings, to change; the rest stay as they are. */
export type NotificationPreferencesChange = Partial<NotificationPreferences>

/** A buyer who never changed a setting has them all on. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  cart_reminder_push: true,
  cart_reminder_email: true,
  orders_on_lock_screen: true,
}

/** Just the settings, from a saved row or anything else carrying them. */
export const settingsOf = (row: NotificationPreferences): NotificationPreferences =>
  Object.fromEntries(NOTIFICATION_PREFERENCE_KEYS.map((key) => [key, row[key]])) as NotificationPreferences

/** The buyer's notification settings. */
export async function notificationPreferencesOf(scope: Scope, customerId: string): Promise<NotificationPreferences> {
  const service = scope.resolve<NotificationPreferenceModuleService>(NOTIFICATION_PREFERENCE_MODULE)
  const [saved] = await service.listNotificationPreferences({ customer_id: customerId })
  if (!saved) return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  return settingsOf(saved)
}

/**
 * Whether the buyer lets their shop orders run on the Lock Screen (#145). Everything that would
 * start an activity or a Live Update asks this, on iOS and Android alike. Order pushes don't: they
 * have no setting, and iOS's own per-app setting applies on top of this one.
 */
export async function ordersOnLockScreenOn(scope: Scope, customerId: string): Promise<boolean> {
  return (await notificationPreferencesOf(scope, customerId)).orders_on_lock_screen
}

/** Changes the buyer's settings named in `change`, keeping the others; returns them all. */
export async function setNotificationPreferences(
  scope: Scope,
  customerId: string,
  change: NotificationPreferencesChange
): Promise<NotificationPreferences> {
  const { result } = await setNotificationPreferencesWorkflow(scope as MedusaContainer).run({
    input: { customer_id: customerId, change },
  })
  return result
}
