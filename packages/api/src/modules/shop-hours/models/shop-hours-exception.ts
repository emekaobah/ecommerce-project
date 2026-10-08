import { model } from "@medusajs/framework/utils"

/**
 * A date or date range a shop is closed, or open with special hours instead of its weekly ones
 * (ADR 0004): holidays, stocktakes, opening on a normally closed day.
 */
const ShopHoursException = model
  .define("shop_hours_exception", {
    id: model.id({ prefix: "shopexc" }).primaryKey(),
    seller_id: model.text(),
    /** Local dates, YYYY-MM-DD, both included. */
    starts_on: model.text(),
    ends_on: model.text(),
    closed: model.boolean(),
    /** The special hours (`OpenPeriod[]`) when not closed. */
    periods: model.json(),
    /** What buyers are told, e.g. "Closed for Eid". */
    note: model.text().nullable(),
  })
  .indexes([{ on: ["seller_id", "ends_on"] }])

export default ShopHoursException
