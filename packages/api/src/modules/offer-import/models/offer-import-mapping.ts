import { model } from "@medusajs/framework/utils"

/** A shop's column mapping from its last product-list import, reused on the next one (#37). */
const OfferImportMapping = model.define("offer_import_mapping", {
  id: model.id({ prefix: "oimap" }).primaryKey(),
  seller_id: model.text().unique(),
  /** Column name → import field key. */
  mapping: model.json().default({}),
})

export default OfferImportMapping
