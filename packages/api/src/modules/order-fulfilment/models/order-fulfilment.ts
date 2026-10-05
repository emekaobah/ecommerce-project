import { model } from "@medusajs/framework/utils"

/**
 * Where a seller order is in the fulfilment state machine (`@oja/domain`'s `transition`). An
 * order with no row yet is New: a row is written when the order is placed, or by the first
 * transition of an order placed before then.
 */
const OrderFulfilment = model
  .define("order_fulfilment", {
    id: model.id({ prefix: "ofl" }).primaryKey(),
    order_id: model.text().unique(),
    /** The fulfilment's state, kept apart from `fulfilment` so jobs can find orders by it. */
    state: model.text(),
    /** The `Fulfilment` itself, with what each state carries (who rejected, the handover). */
    fulfilment: model.json(),
    /** When the order was placed; the accept deadline counts from here. */
    placed_at: model.dateTime(),
    /** Why the shop rejected the order, as staff gave it. */
    reject_reason: model.text().nullable(),
    /** How many of each line staff have picked so far, by line item id; a line not listed has none. */
    picks: model.json().nullable(),
  })
  .indexes([{ on: ["state", "placed_at"] }])

export default OrderFulfilment
