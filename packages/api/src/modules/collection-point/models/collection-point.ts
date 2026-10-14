import { model } from "@medusajs/framework/utils"

/**
 * Where a shop's buyers collect their pickup orders (#12, docs/design.md → Pickup): one per shop,
 * and a shop with one offers pickup at checkout. It is open when the shop is (ADR 0004).
 */
const CollectionPoint = model.define("collection_point", {
  id: model.id({ prefix: "cpt" }).primaryKey(),
  seller_id: model.text().unique(),
  /**
   * Whether it is the shop's pickup address, followed as that changes. Choosing it is the shop's
   * consent to showing that address to buyers.
   */
  follows_pickup_address: model.boolean(),
  /**
   * A separate address, when it doesn't follow the pickup address: Medusa's address columns,
   * with the pin and landmark in `metadata` (ADR 0002). Null while it follows.
   */
  address: model.json().nullable(),
  /** What buyers are told about collecting there. */
  instructions: model.text(),
  /** A number buyers can call about collecting, in E.164. */
  phone: model.text().nullable(),
})

export default CollectionPoint
