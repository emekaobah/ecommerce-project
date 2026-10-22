import { model } from "@medusajs/framework/utils"
import { HOLD_REMINDERS, ORDER_PHASES } from "@oja/domain"

/**
 * Where a seller order is in the fulfilment state machine (`@oja/domain`'s `transition`), and
 * whose order it is: its buyer, shop and checkout, so a shop's or a buyer's orders are found
 * through an index (#58). Every order has one: written when the order is placed, or by staff
 * acting on it the moment it appears, and backfilled for orders placed before
 * (`migration-scripts/backfill-order-fulfilments`).
 */
const OrderFulfilment = model
  .define("order_fulfilment", {
    id: model.id({ prefix: "ofl" }).primaryKey(),
    order_id: model.text().unique(),
    /** The order's buyer; null for an order placed without a customer account. */
    customer_id: model.text().nullable(),
    /** The order's shop; null only on a row placed before #58 that the backfill has yet to fill. */
    seller_id: model.text().nullable(),
    /** The checkout (Mercur's order group) the order was split from; null for an order placed outside one. */
    order_group_id: model.text().nullable(),
    /** The fulfilment's state, kept apart from `fulfilment` so jobs can find orders by it. */
    state: model.text(),
    /**
     * Whether the order is still happening for its buyer (#59), by `@oja/domain`'s `orderPhase`
     * of its state and refunds: written with either (`lib/order-phase`).
     */
    phase: model.enum([...ORDER_PHASES]),
    /** The `Fulfilment` itself, with what each state carries (who rejected, the handover). */
    fulfilment: model.json(),
    /** When the order was placed; the accept deadline counts from here. */
    placed_at: model.dateTime(),
    /** Why the shop rejected the order, as staff gave it. */
    reject_reason: model.text().nullable(),
    /** How many of each line staff have picked so far, by line item id; a line not listed has none. */
    picks: model.json().nullable(),
    /**
     * How many of each line staff marked unavailable while picking, by line item id, waiting to
     * be removed from the order (#22). Cleared once they are.
     */
    unavailable: model.json().nullable(),
    /** How many of each line were removed from the order as unavailable, by line item id (#22). */
    removed: model.json().nullable(),
    /** When staff were reminded that the order waits to be accepted; it is reminded once (#27). */
    accept_reminded_at: model.dateTime().nullable(),
    /** The courier shipment booked for the order (#24): the latest, also once cancelled. */
    shipment: model.json().nullable(),
    /**
     * A courier staff chose that costs the platform more than the top-up cap above the buyer's
     * checkout price, waiting for Oja's team to approve it (#19). Cleared once a label is booked
     * or the team declines it.
     */
    courier_approval: model.json().nullable(),
    /** The shipment's id with Shipbubble, which its webhooks name. */
    shipment_id: model.text().nullable(),
    /** When the order last reached each state (`@oja/domain`'s `Reached`), for its timeline (#25). */
    reached: model.json().nullable(),
    /** When the order was delivered or collected, and so may be paid out to the shop (#25, #29, #12). */
    payout_eligible_at: model.dateTime().nullable(),
    /**
     * A pickup order's code (#12): random digits, issued when it is Ready for pickup, shown only
     * to its buyer, and checked at the counter.
     */
    pickup_code: model.text().nullable(),
    /** When wrong pickup codes were tried on the order (ISO 8601), for the attempt limit. */
    pickup_code_attempts: model.array().nullable(),
    /** When the owner was last alerted that staff and the courier disagree about the handover; daily while they do (#25). */
    handover_alerted_at: model.dateTime().nullable(),
    /** The last reminder the buyer of a pickup order still to collect had (#33): half-way through its hold, then its last day. */
    hold_reminded: model.enum([...HOLD_REMINDERS]).nullable(),
  })
  .indexes([
    { on: ["state", "placed_at"] },
    { on: ["shipment_id"] },
    // The buyer's orders in progress or past, newest first (#59).
    { on: ["customer_id", "phase", "placed_at"] },
    // The shop's orders by state: its counts and stage lists.
    { on: ["seller_id", "state"] },
    { on: ["order_group_id"] },
  ])

export default OrderFulfilment
