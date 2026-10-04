import { model } from "@medusajs/framework/utils"

/**
 * What a shop paid for what one of its offers sells (#37): private to the shop's
 * owner and managers, so it is kept here rather than on the offer, whose reads
 * fulfilment staff share. Used to warn when an offer is priced below cost.
 */
const OfferCost = model
  .define("offer_cost", {
    id: model.id({ prefix: "ocost" }).primaryKey(),
    offer_id: model.text().unique(),
    seller_id: model.text(),
    /** In major units, like offer prices. */
    amount: model.bigNumber(),
    currency_code: model.text(),
  })
  .indexes([{ on: ["seller_id"] }])

export default OfferCost
