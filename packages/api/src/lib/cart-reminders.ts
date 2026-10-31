import { createHash } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  CART_REMINDER_SCHEDULE,
  cartReminderContent,
  cartReminderDue,
  type CartReminded,
  type CartReminderContent,
  type CartReminderLine,
  type CartReminderSchedule,
} from "@oja/domain"
import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import { emailCartReminder, pushCartReminder } from "./buyer-notifications"
import { checkCartLines, type CartLineCheck } from "./cart-line-check"
import { errorMessage } from "./errors"
import { notificationPreferencesOf } from "./notification-preferences"

// The cart reminder (#134). An hourly job reminds a signed-in buyer of the cart they left
// unpaid, once per change of its items: four hours after its items last changed, between 9am
// and 8pm Lagos time (`cartReminderDue` in @oja/domain decides). It names the shops and lines that
// can be bought now, from the same check checkout reprices with (#135); a cart with none gets
// nothing. The push (#137) and the email (#139) go out here, each unless the buyer turned it off
// in their notification settings (#138).
//
// When a cart's items last changed comes from its line items' own timestamps, removed lines
// included (Medusa soft-deletes them): created, updated, or removed; the delay runs from it. What
// the reminder was about is a fingerprint of the cart's live lines (each line, its variant and
// offer, and how many), kept in the marker in the cart's metadata: only the buyer changing the
// items changes it, so a line the backend touches without changing it (checkout repricing it)
// doesn't remind them again. Each channel's idempotency keys build on the fingerprint too.

type Scope = Pick<MedusaContainer, "resolve">

/** The cart metadata key holding its reminder marker (`CartReminded`). */
export const CART_REMINDED_KEY = "cart_reminded"

/** A cart idle longer than this isn't reminded about: the buyer has moved on (and carts from before reminders existed stay quiet). */
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

/** A payment collection in one of these hasn't taken the buyer's money; any other has, so the cart counts as paid. */
const UNPAID_STATUSES = new Set(["not_paid", "awaiting", "canceled", "failed"])

/**
 * A cart reminder ready to go out on each channel: whose cart, which change of its items it is
 * about, and what it says (the same for push and email).
 */
export type CartReminder = {
  cart_id: string
  customer_id: string
  /** The cart's email address, for the email reminder (#139). */
  email: string | null
  /** The cart and the items this reminder is about; each channel's idempotency keys build on it (ADR 0008). */
  key: string
  content: CartReminderContent
}

const hours = (value: string | undefined, fallback: number, max: number) => {
  const n = value === undefined || value.trim() === "" ? Number.NaN : Number(value)
  return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback
}

/**
 * When reminders go out, from config: `CART_REMINDER_DELAY_HOURS` (default 4),
 * `CART_REMINDER_SEND_FROM_HOUR` and `CART_REMINDER_SEND_UNTIL_HOUR` (default 9 and 20) in
 * `CART_REMINDER_TIME_ZONE` (default Africa/Lagos). A value that isn't a number in range falls
 * back to its default.
 */
export function cartReminderSchedule(env: NodeJS.ProcessEnv = process.env): CartReminderSchedule {
  const d = CART_REMINDER_SCHEDULE
  return {
    delay_hours: hours(env.CART_REMINDER_DELAY_HOURS, d.delay_hours, 24 * 30),
    send_from_hour: hours(env.CART_REMINDER_SEND_FROM_HOUR, d.send_from_hour, 23),
    send_until_hour: hours(env.CART_REMINDER_SEND_UNTIL_HOUR, d.send_until_hour, 24),
    time_zone: env.CART_REMINDER_TIME_ZONE?.trim() || d.time_zone,
  }
}

/** A signed-in buyer's open cart with items, as the job finds it. */
type IdleCart = {
  id: string
  customer_id: string
  email: string | null
  metadata: Record<string, unknown> | null
  items_changed_at: string
  /** Its live lines' fingerprint (`CartReminderCart.items`). */
  items: string
}

/** Items last changed: the latest any line was added, updated or removed (GREATEST skips NULLs). */
const ITEMS_CHANGED_AT = "max(greatest(li.created_at, li.updated_at, li.deleted_at))"

/** The cart's live lines, each as what it is and how many, in a stable order: what the buyer chose. */
const LIVE_ITEMS =
  "string_agg(concat_ws('|', li.id, li.variant_id, li.metadata->>'offer_id', li.quantity), ',' ORDER BY li.id) FILTER (WHERE li.deleted_at IS NULL)"

/** A short fingerprint of a cart's live lines, for the marker and idempotency keys. */
const fingerprint = (liveItems: string) => createHash("sha256").update(liveItems).digest("base64url").slice(0, 22)

/**
 * Each signed-in buyer's open cart whose items changed most recently, if it still has items and
 * they changed within the lookback. One per buyer, so a buyer with carts on two phones is
 * reminded once. A shop cart (#11, "pay for this shop only") is part of its original cart, which
 * gets the reminder.
 */
async function latestCarts(scope: Scope, now: Date): Promise<IdleCart[]> {
  const knex = scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION)
  const rows: (Omit<IdleCart, "items_changed_at" | "items"> & { items_changed_at: Date; live_items: string | null })[] = await knex("cart as c")
    .join("cart_line_item as li", "li.cart_id", "c.id")
    .whereNotNull("c.customer_id")
    .whereNull("c.completed_at")
    .whereNull("c.deleted_at")
    .whereRaw(`(c.metadata->>'shop_cart_of') IS NULL`)
    .groupBy("c.id")
    .havingRaw(`${ITEMS_CHANGED_AT} > ?`, [new Date(now.getTime() - LOOKBACK_MS)])
    .select(
      "c.id",
      "c.customer_id",
      "c.email",
      "c.metadata",
      knex.raw(`${ITEMS_CHANGED_AT} AS items_changed_at`),
      knex.raw(`${LIVE_ITEMS} AS live_items`)
    )
  const latest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const seen = latest.get(row.customer_id)
    if (!seen || row.items_changed_at > seen.items_changed_at) latest.set(row.customer_id, row)
  }
  return [...latest.values()].flatMap(({ live_items, items_changed_at, ...row }) =>
    live_items ? [{ ...row, items_changed_at: new Date(items_changed_at).toISOString(), items: fingerprint(live_items) }] : []
  )
}

/** The carts whose payment has been taken, though not yet completed into orders. */
async function paidCarts(scope: Scope, cartIds: string[]): Promise<Set<string>> {
  if (!cartIds.length) return new Set()
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "cart",
    fields: ["id", "payment_collection.status"],
    filters: { id: cartIds },
  })
  type Row = { id: string; payment_collection?: { status: string } | null }
  return new Set(
    (data as unknown as Row[]).filter((c) => c.payment_collection && !UNPAID_STATUSES.has(c.payment_collection.status)).map((c) => c.id)
  )
}

const remindedOf = (metadata: Record<string, unknown> | null): CartReminded | null => {
  const marker = metadata?.[CART_REMINDED_KEY] as Partial<CartReminded> | undefined
  return typeof marker?.at === "string" && typeof marker.items_changed_at === "string" && typeof marker.items === "string"
    ? { at: marker.at, items_changed_at: marker.items_changed_at, items: marker.items }
    : null
}

const reminderLine = (line: CartLineCheck): CartReminderLine => ({
  shop: line.seller?.name ?? "",
  product_title: line.product_title,
  variant_title: line.variant_title,
  quantity: line.quantity,
  added_unit_price: line.added_at.unit_price,
  unit_price: line.now?.unit_price ?? null,
  available_quantity: line.available_quantity,
  taking_orders: !!line.seller && line.not_taking_orders === null,
})

/**
 * Sends a cart reminder on each channel the buyer hasn't turned off (#138). Each channel is told
 * once per reminder however often it is asked (idempotency keys built on `reminder.key`), so a
 * retried run never doubles one.
 */
export async function sendCartReminder(scope: Scope, reminder: CartReminder): Promise<void> {
  const preferences = await notificationPreferencesOf(scope, reminder.customer_id)
  await Promise.all([
    preferences.cart_reminder_push && pushCartReminder(scope, reminder),
    preferences.cart_reminder_email && emailCartReminder(scope, reminder),
  ])
}

/** Reminds the buyer of one due cart, if anything in it can be bought now, and marks it reminded. */
async function remindAbout(scope: Scope, cart: IdleCart, now: Date): Promise<void> {
  const check = await checkCartLines(scope as MedusaContainer, cart.id, now)
  const content = cartReminderContent(check.lines.map(reminderLine), check.currency_code)
  // Nothing to buy now: no reminder. It stays due, in case a shop restocks or reopens.
  if (!content) return
  await sendCartReminder(scope, {
    cart_id: cart.id,
    customer_id: cart.customer_id,
    email: cart.email,
    key: `${cart.id}:${cart.items}`,
    content,
  })
  const reminded: CartReminded = { at: now.toISOString(), items_changed_at: cart.items_changed_at, items: cart.items }
  await scope.resolve(Modules.CART).updateCarts(cart.id, { metadata: { ...cart.metadata, [CART_REMINDED_KEY]: reminded } })
}

/**
 * The hourly cart reminder job (#134): reminds each signed-in buyer whose cart is due
 * (`cartReminderDue`) about it, with the schedule from config. A cart that can't be reminded
 * about is logged, and the others still are.
 */
export async function remindIdleCarts(scope: Scope, now = new Date(), schedule = cartReminderSchedule()): Promise<void> {
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const carts = await latestCarts(scope, now)
  const paid = await paidCarts(scope, carts.map((c) => c.id))
  const due = carts.filter((cart) =>
    cartReminderDue(
      {
        signed_in: true,
        has_items: true,
        paid: paid.has(cart.id),
        items_changed_at: cart.items_changed_at,
        items: cart.items,
        reminded: remindedOf(cart.metadata),
      },
      now,
      schedule
    )
  )
  for (const cart of due) {
    try {
      await remindAbout(scope, cart, now)
    } catch (error) {
      logger.warn(`Reminding the buyer of cart ${cart.id} failed: ${errorMessage(error)}`)
    }
  }
}
