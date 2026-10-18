import { model } from "@medusajs/framework/utils"

/**
 * A shop's pause in taking orders (ADR 0004): closed from `starts_at` until resumed or until a
 * set time. Resuming ends it rather than deleting it: the open-hours clocks (the pickup hold,
 * and the accept deadline of an order placed before it) need the time it was paused.
 */
const ShopPause = model
  .define("shop_pause", {
    id: model.id({ prefix: "shoppau" }).primaryKey(),
    seller_id: model.text(),
    starts_at: model.dateTime(),
    /** Null until resumed, unless set to end at a time. */
    ends_at: model.dateTime().nullable(),
    /** What buyers are told, e.g. "Back after the power cut". */
    note: model.text().nullable(),
  })
  .indexes([{ on: ["seller_id", "ends_at"] }])

export default ShopPause
