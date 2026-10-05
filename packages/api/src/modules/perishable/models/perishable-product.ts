import { model } from "@medusajs/framework/utils"

/**
 * The operator's override of whether a product is perishable (#69), winning over its
 * categories either way. No row: the product follows its categories. Kept here, not on the
 * product's metadata, which shops can write through the vendor routes.
 */
const PerishableProduct = model.define("perishable_product", {
  id: model.id({ prefix: "prod_per" }).primaryKey(),
  product_id: model.text().unique(),
  perishable: model.boolean(),
})

export default PerishableProduct
