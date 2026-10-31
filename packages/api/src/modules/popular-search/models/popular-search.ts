import { model } from "@medusajs/framework/utils"

/**
 * One of a region's popular searches, as the hourly job last published them (#124): the Search
 * tab's "Popular on Oja" chips, `rank` 0 first. Each run replaces the region's list.
 */
const PopularSearch = model
  .define("popular_search", {
    id: model.id({ prefix: "popsrch" }).primaryKey(),
    region_id: model.text(),
    term: model.text(),
    rank: model.number(),
  })
  .indexes([{ on: ["region_id"] }])

export default PopularSearch
