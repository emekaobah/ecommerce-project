import { model } from "@medusajs/framework/utils"

/**
 * One shop order on one buyer's Android phone: the record an iPhone's `live_activity` row keeps,
 * for a phone with no Apple token and no key. Its start and end follow the same rules, so an order
 * accepted while "Orders on Lock Screen" was off never shows, and one the switch ended stays ended.
 */
const BuyerLiveUpdate = model
  .define("buyer_live_update", {
    id: model.id({ prefix: "blupd" }).primaryKey(),
    /** The phone's Expo push token (`push_token.token`). */
    push_token: model.text(),
    customer_id: model.text(),
    order_id: model.text(),
    ended_at: model.dateTime().nullable(),
  })
  .indexes([{ on: ["push_token", "order_id"], unique: true }, { on: ["customer_id"] }])

export default BuyerLiveUpdate
