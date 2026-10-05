import { model } from "@medusajs/framework/utils"

/**
 * A catalogue category the operator marked perishable (#69). Its products, and those of its
 * sub-categories, go out only with couriers delivering by the end of the next day. Kept here,
 * not on the category's metadata, so only the operator's routes can set it.
 */
const PerishableCategory = model.define("perishable_category", {
  id: model.id({ prefix: "pcat_per" }).primaryKey(),
  category_id: model.text().unique(),
  perishable: model.boolean(),
})

export default PerishableCategory
