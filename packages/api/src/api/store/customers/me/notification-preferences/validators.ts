import { z } from "@medusajs/framework/zod"

/** Some of the buyer's notification settings, each on or off (#138); the ones left out stay as they are. */
export const StoreUpdateNotificationPreferences = z
  .object({
    cart_reminder_push: z.boolean().optional(),
    cart_reminder_email: z.boolean().optional(),
    orders_on_lock_screen: z.boolean().optional(),
  })
  .strict()

export type StoreUpdateNotificationPreferencesType = z.infer<typeof StoreUpdateNotificationPreferences>
