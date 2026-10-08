import { model } from "@medusajs/framework/utils"

/**
 * A shop's weekly opening hours (ADR 0004): per weekday, the periods it is open, as local
 * "HH:MM" times in its region's timezone (`WeeklyHours`, `@oja/domain`). One row per shop;
 * having one is an onboarding gate (ADR 0007).
 */
const ShopWeeklyHours = model.define("shop_weekly_hours", {
  id: model.id({ prefix: "shophrs" }).primaryKey(),
  seller_id: model.text().unique(),
  weekly: model.json(),
})

export default ShopWeeklyHours
