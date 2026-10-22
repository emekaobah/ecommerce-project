import { model } from "@medusajs/framework/utils"

/**
 * Where a shop's pickup address is pinned, in columns the database can measure from, so listings
 * rank by distance in SQL (ADR 0014). A copy of the pin in the seller address's metadata, which
 * stays the source: every write of the pickup address refreshes it (`workflows/hooks/shop-pin.ts`).
 * Never shown to buyers (ADR 0011). No row: the shop has no pin.
 */
const ShopPin = model.define("shop_pin", {
  id: model.id({ prefix: "shpin" }).primaryKey(),
  seller_id: model.text().unique(),
  latitude: model.float(),
  longitude: model.float(),
})

export default ShopPin
