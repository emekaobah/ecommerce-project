import { model } from "@medusajs/framework/utils"

/**
 * A buyer's notification settings (#138), one row per buyer, made the first time they change
 * one: a buyer without a row has every setting on. Each setting is a column that defaults to on,
 * so a later setting (#133's Orders on Lock Screen) is one more column.
 */
const NotificationPreference = model.define("notification_preference", {
  id: model.id({ prefix: "npref" }).primaryKey(),
  customer_id: model.text().unique(),
  /** Pushes about a cart left unpaid (#137). */
  cart_reminder_push: model.boolean().default(true),
  /** Emails about a cart left unpaid (#139). */
  cart_reminder_email: model.boolean().default(true),
})

export default NotificationPreference
