import { model } from "@medusajs/framework/utils"

/**
 * A search a buyer used on the Search tab (#124): submitted, or a product opened from its
 * results; never a keystroke. No buyer: only an anonymous id the phone made for itself, so one
 * phone counts once however often it searches. Kept 90 days (`lib/popular-searches.ts`).
 */
const SearchRecord = model
  .define("search_record", {
    id: model.id({ prefix: "srch" }).primaryKey(),
    /** Lower-case, trimmed, its spaces collapsed (`normaliseSearch`). */
    term: model.text(),
    region_id: model.text(),
    /** The phone's own random id (a UUID), never the buyer's. */
    phone_id: model.text(),
    searched_at: model.dateTime(),
  })
  .indexes([{ on: ["searched_at"] }])

export default SearchRecord
