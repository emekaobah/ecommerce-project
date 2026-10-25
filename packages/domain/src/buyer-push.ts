import { PRODUCT_NAME } from "./app-identity"
import { cancelledBy, cancelReasonText } from "./cancellation"
import type { Cancellation, FulfilmentState } from "./fulfilment"
import { formatMoney } from "./money"
import { openingHoursLines } from "./pickup"
import type { HoldReminder } from "./pickup-hold"
import type { WeeklyHours } from "./shop-hours"

/**
 * What a buyer's phone is told about their orders (#5): their checkout confirmed, and each step
 * of a shop's order they care about. The backend sends these; tapping one opens the order.
 */

/** A push's title and body. */
export type BuyerPush = { title: string; body: string }

/** Where a pickup order is collected (#12), as its push says: the collection point and the shop's hours. */
export type BuyerPushPickup = {
  address: { address_1: string | null; address_2: string | null; city: string | null; landmark: string | null }
  weekly: WeeklyHours | null
}

/**
 * One shop's order, as a push about it names it: by its checkout's `number` ("OJ-12", `orderNumber` of the
 * order group's `display_id`), the one the buyer app shows (#97); `pickup` for an order the buyer
 * collects.
 */
export type BuyerPushOrder = {
  number: string
  shop: string
  rejected_by: "seller" | "accept_deadline" | null
  pickup?: BuyerPushPickup | null
}

/** Where and when to collect a pickup order, for its Ready for pickup push. */
function collectFrom(shop: string, { address, weekly }: BuyerPushPickup) {
  const place = [address.address_1, address.address_2, address.city].filter(Boolean).join(", ")
  const landmark = address.landmark ? ` (${address.landmark})` : ""
  const where = `Collect it from ${shop}, ${place}${landmark}.`
  return weekly ? `${where} Hours: ${openingHoursLines(weekly).join("; ")}.` : where
}

/**
 * The push for each state a buyer is told about. The shop's own steps (picking, packing, the
 * courier confirming) aren't pushed; a state not listed sends nothing.
 */
const STATE_PUSHES: { [S in FulfilmentState]?: (order: BuyerPushOrder) => BuyerPush } = {
  accepted: ({ number, shop }) => ({
    title: `Order ${number} accepted`,
    body: `${shop} is preparing your order.`,
  }),
  label_booked: ({ number, shop }) => ({
    title: `Courier booked for order ${number}`,
    body: `${shop} has booked a courier to deliver your order.`,
  }),
  handed_to_courier: ({ number, shop }) => ({
    title: `Order ${number} picked up`,
    body: `The courier has collected your order from ${shop}.`,
  }),
  delivered: ({ number, shop }) => ({
    title: `Order ${number} delivered`,
    body: `Your order from ${shop} has arrived.`,
  }),
  // In-store pickup (#12): the code to collect with is only in the app. Collected is pushed with
  // its receipt (`orderCollectedPush`, #33), Not collected with what is refunded (`notCollectedPush`).
  ready_for_pickup: ({ number, shop, pickup }) => ({
    title: `Order ${number} is ready for pickup`,
    body: [`Your pickup code is in the ${PRODUCT_NAME} app.`, pickup ? collectFrom(shop, pickup) : null].filter(Boolean).join(" "),
  }),
  rejected: ({ number, shop, rejected_by }) => ({
    title: `Order ${number} cancelled`,
    body: `${shop} ${rejected_by === "accept_deadline" ? "didn't accept your order in time" : "couldn't take your order"}. You'll get a full refund.`,
  }),
}

/** The push telling the buyer their order reached `state`, or null for a state they aren't pushed about. */
export function buyerStatusPush(state: FulfilmentState, order: BuyerPushOrder): BuyerPush | null {
  return STATE_PUSHES[state]?.(order) ?? null
}

/**
 * A shop in a confirmed checkout. `opens`: when a shop closed at checkout opens again (e.g.
 * "8am Tue"), so the order is prepared then (ADR 0004); null while it is open.
 */
export type ConfirmedShop = { name: string; opens: string | null }

/** What a shop closed at checkout means for its order. */
export const preparedWhenOpen = ({ name, opens }: ConfirmedShop & { opens: string }) =>
  `${name} is closed now: it prepares your order when it opens at ${opens}.`

/** The push confirming a paid checkout, split into an order per shop. */
export function orderConfirmedPush({ number, shops }: { number: string; shops: ConfirmedShop[] }): BuyerPush {
  const closed = shops.flatMap((shop) => (shop.opens ? [preparedWhenOpen({ ...shop, opens: shop.opens })] : []))
  const [only] = shops
  const next =
    shops.length === 1 && only ? `We'll let you know when ${only.name} accepts it.` : `We'll let you know as each of your ${shops.length} shops accepts it.`
  return { title: `Order ${number} confirmed`, body: closed.length ? closed.join(" ") : next }
}

/** A line the shop removed as unavailable while picking, and how many of it. */
export type RemovedItem = { title: string; quantity: number }

/** Two lines are named; more are counted, to keep a push short. */
function namedItems(items: RemovedItem[]) {
  const units = items.reduce((sum, item) => sum + item.quantity, 0)
  return items.length <= 2 ? items.map((item) => `${item.quantity} × ${item.title}`).join(" and ") : `${units} of your items`
}

/**
 * The push telling the buyer a shop removed items it didn't have from their order, and what it
 * refunds for them (#22). Two lines are named; more are counted, to keep the push short.
 */
export function itemsRemovedPush({
  number,
  shop,
  items,
  refund,
  currency_code,
}: {
  number: string
  shop: string
  items: RemovedItem[]
  refund: number
  currency_code: string
}): BuyerPush {
  const removed = namedItems(items)
  return {
    title: `Items removed from order ${number}`,
    body: `${shop} didn't have ${removed}. You'll be refunded ${formatMoney(refund, currency_code)}.`,
  }
}

/**
 * The push telling the buyer an accepted order was cancelled (#17): by its shop or by Oja's
 * team, why, and what they are refunded (none when nothing was paid for it).
 */
export function orderCancelledPush({
  number,
  shop,
  cancellation,
  refund,
  currency_code,
}: {
  number: string
  shop: string
  cancellation: Pick<Cancellation, "by" | "reason" | "note">
  refund: number
  currency_code: string
}): BuyerPush {
  const from = cancellation.by === "operator" ? ` from ${shop}` : ""
  const who = `${cancelledBy(cancellation.by, shop)} cancelled your order${from}`
  const refunded = refund > 0 ? ` You'll be refunded ${formatMoney(refund, currency_code)}.` : ""
  return { title: `Order ${number} cancelled`, body: `${who}: ${cancelReasonText(cancellation)}.${refunded}` }
}

/**
 * The push telling the buyer their order was booked with another courier than they chose at
 * checkout (#19), and when it now arrives (`deliveryEstimate`).
 */
export function courierChangedPush({ number, shop, courier, arrives }: { number: string; shop: string; courier: string; arrives: string }): BuyerPush {
  return { title: `New courier for order ${number}`, body: `Your order from ${shop} is now shipping with ${courier}. ${arrives}.` }
}

/** A refund of one of the buyer's orders, as they are told about it: its order, shop and amount. */
export type RefundNotice = { number: string; shop: string; amount: number; currency_code: string }

/** The push telling the buyer a refund of their order has reached them (Paystack processed it). */
export function refundCompletedPush({ number, shop, amount, currency_code }: RefundNotice): BuyerPush {
  return {
    title: `Refund for order ${number} completed`,
    body: `The refund of ${formatMoney(amount, currency_code)} from ${shop} has completed.`,
  }
}

/**
 * The push telling the buyer Oja's team is sending their refund by hand (#16): Paystack can't
 * make it (under its ₦50 minimum), or refused every retry.
 */
export function refundByHandPush({ number, shop, amount, currency_code }: RefundNotice): BuyerPush {
  return {
    title: `Refund for order ${number}`,
    body: `Our team is sending your ${formatMoney(amount, currency_code)} refund for your order from ${shop}.`,
  }
}

/** A reminder that a refund still needs the buyer's bank account: how many days before Oja's team takes it over. */
export type RefundAccountReminder = { days_left: number }

/**
 * The push asking the buyer for a bank account to receive a refund (#13): Paystack couldn't
 * return it to their card. A reminder says how long they have before Oja's team takes it over.
 */
export function refundAccountPush({ number, shop, amount, currency_code }: RefundNotice, reminder?: RefundAccountReminder): BuyerPush {
  const refund = formatMoney(amount, currency_code)
  if (!reminder) {
    return {
      title: "Your refund needs your bank account",
      body: `Your bank couldn't take the ${refund} refund for order ${number} from ${shop} back to your card. Add a bank account to receive it.`,
    }
  }
  const days = reminder.days_left === 1 ? "1 day" : `${reminder.days_left} days`
  return {
    title: "Reminder: your refund needs your bank account",
    body: `Add a bank account to receive your ${refund} refund for order ${number}. If you don't within ${days}, our team will contact you.`,
  }
}

const CODE_IN_APP = `Your pickup code is in the ${PRODUCT_NAME} app.`

/**
 * The push reminding the buyer to collect a pickup order (#33): half-way through its hold, and on
 * its last day, saying what happens then. `collect_by` is `collectByLabel`'s; `perishable`
 * whether fresh items on it stay unrefunded once it isn't collected.
 */
export function holdReminderPush({
  number,
  shop,
  reminder,
  collect_by,
  perishable,
}: {
  number: string
  shop: string
  reminder: HoldReminder
  collect_by: string
  perishable: boolean
}): BuyerPush {
  if (reminder === "half_way") {
    return { title: `Order ${number} is waiting for you`, body: `${collect_by} from ${shop}. ${CODE_IN_APP}` }
  }
  const refunded = perishable ? "or it is refunded instead, except its fresh items" : "or it is refunded instead"
  return { title: `Last day to collect order ${number}`, body: `${collect_by} from ${shop}, ${refunded}. ${CODE_IN_APP}` }
}

/** The push sent with the receipt of a pickup order the buyer collected (#33). */
export function orderCollectedPush({ number, shop }: { number: string; shop: string }): BuyerPush {
  return { title: `Order ${number} collected`, body: `You collected your order from ${shop}. Your receipt is in your email.` }
}

/**
 * The push telling the buyer a pickup order wasn't collected before its hold ended (#33, #32):
 * what they are refunded (its non-perishable lines), and the fresh lines (`kept`) that aren't.
 * It stands for the refund's own "completed" push, which isn't sent for it.
 */
export function notCollectedPush({
  number,
  shop,
  refund,
  currency_code,
  kept,
}: {
  number: string
  shop: string
  refund: number
  currency_code: string
  kept: RemovedItem[]
}): BuyerPush {
  const body = [
    `${shop} held it, but it wasn't collected in time.`,
    refund > 0 ? `You'll be refunded ${formatMoney(refund, currency_code)}.` : null,
    kept.length ? `Fresh items aren't refunded: ${namedItems(kept)}.` : null,
  ]
  return { title: `Order ${number} wasn't collected`, body: body.filter(Boolean).join(" ") }
}
