import { model } from "@medusajs/framework/utils"
import LiveActivityDevice from "./live-activity-device"

/** A shop a phone turned "Orders on Lock Screen" on for: per phone and per shop, off until it is here (#146). */
const LiveActivityShop = model
  .define("live_activity_shop", {
    id: model.id({ prefix: "lashop" }).primaryKey(),
    device: model.belongsTo(() => LiveActivityDevice, { mappedBy: "shops" }),
    seller_id: model.text(),
  })
  .indexes([{ on: ["device_id", "seller_id"], unique: true }, { on: ["seller_id"] }])

export default LiveActivityShop
