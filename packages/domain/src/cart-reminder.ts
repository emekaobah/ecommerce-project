import type { BuyerPush } from "./buyer-push"
import { formatMoney } from "./money"
import { stockLeftLabel } from "./stock"

/**
 * The cart reminder (#134): a signed-in buyer who leaves items in their cart, unpaid, is reminded
 * once, by push (#137) and email (#139), naming the shops, the top items and any good news.
 */

const HOUR_MS = 60 * 60 * 1000

/**
 * What a cart reminder's push data (`from`) and its email's link (`?from=`) carry, so an open from
 * a reminder can be told apart from any other (story 38).
 */
export const CART_REMINDER_FROM = "cart_reminder"

/**
 * The analytics events that measure cart reminders (story 38). They are sent once PostHog is set
 * up; nothing sends them yet.
 */
export const CART_REMINDER_EVENTS = {
  /** A reminder went to the buyer. */
  sent: "cart reminder sent",
  /** The buyer opened the app from a reminder's push or email (`from` is `CART_REMINDER_FROM`). */
  opened: "cart reminder opened",
  /** The buyer checked out after opening a reminder. */
  checkout: "checkout after cart reminder",
} as const

/** When reminders go out: how long a cart's items sit untouched first, and the hours of the day they may be sent in. */
export type CartReminderSchedule = {
  /** How long the cart's items must be left alone. */
  delay_hours: number
  /** The first hour of the day a reminder may go out (local, 0–23). */
  send_from_hour: number
  /** The hour reminders stop for the day (local, 1–24): one isn't sent at or after it. */
  send_until_hour: number
  /** The time zone those hours are in. */
  time_zone: string
}

/** Four hours after the cart's items last changed, between 9am and 8pm Lagos time. */
export const CART_REMINDER_SCHEDULE: CartReminderSchedule = {
  delay_hours: 4,
  send_from_hour: 9,
  send_until_hour: 20,
  time_zone: "Africa/Lagos",
}

/** A cart, as whether to remind its buyer about it is decided. */
export type CartReminderCart = {
  /** It belongs to a signed-in buyer; a guest's cart is never reminded. */
  signed_in: boolean
  has_items: boolean
  /** Completed or paid for. A checkout started and left unpaid isn't. */
  paid: boolean
  /** When a line was last added, removed or touched (ISO 8601); the delay runs from it. */
  items_changed_at: string
  /**
   * What is in the cart: its lines, what each is and how many (a fingerprint the backend makes).
   * It changes only when the buyer changes the items, never when a line is only repriced.
   */
  items: string
  /**
   * The cart's last reminder, if any. The buyer changing its items since (`items` differs) clears
   * it; so does nothing else.
   */
  reminded: CartReminded | null
}

/**
 * A cart's reminder marker: when it was sent, when the cart's lines had last changed then (ISO
 * 8601), and the items it was about (`CartReminderCart.items`).
 */
export type CartReminded = { at: string; items_changed_at: string; items: string }

/** The hour of the day at `at` in `timeZone`, 0–23. */
const hourIn = (at: Date, timeZone: string) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(at))

/**
 * Whether to remind the buyer about their cart now: it is a signed-in buyer's, has items and
 * isn't paid; its items have been left alone for the delay; they haven't been reminded since its
 * items last changed; and it is within the hours reminders are sent. A cart that falls due
 * overnight is due the next morning. Having been reminded, it is due again only once the buyer
 * changes what is in it: a line repriced or otherwise touched by the backend doesn't count.
 */
export function cartReminderDue(cart: CartReminderCart, now: Date, schedule: CartReminderSchedule = CART_REMINDER_SCHEDULE): boolean {
  if (!cart.signed_in || !cart.has_items || cart.paid) return false
  const changedAt = Date.parse(cart.items_changed_at)
  if (now.getTime() - changedAt < schedule.delay_hours * HOUR_MS) return false
  if (cart.reminded?.items === cart.items) return false
  const hour = hourIn(now, schedule.time_zone)
  return hour >= schedule.send_from_hour && hour < schedule.send_until_hour
}

/**
 * A cart line as the reminder sees it: what it was added at, and where it stands now. Only a line
 * its shop still sells has one: a line without a shop can't be bought.
 */
export type CartReminderLine = {
  line_item_id: string
  /** Its shop's name. */
  shop: string
  product_title: string | null
  variant_title: string | null
  quantity: number
  /** Its price for one when it was added (what the cart charges for it). */
  added_unit_price: number
  /** Its offer's price for one now; null when the offer or its shop is gone. */
  unit_price: number | null
  /** How many can still be ordered: 0 is sold out; null when the shop doesn't count. */
  available_quantity: number | null
  /** Its shop takes orders now (one closed outside its hours still does; paused or gone doesn't). */
  taking_orders: boolean
}

/** A line the buyer can buy now, as the reminder shows it. */
export type CartReminderItem = {
  /** Its cart line: two lines can share a title. */
  line_item_id: string
  shop: string
  title: string
  /** As many as can be had now: a line wanting more than is left counts what is left, as checkout will. */
  quantity: number
  unit_price: number
  total: number
  /** How much less one costs now than when it was added; null unless it dropped. */
  price_drop: number | null
  /** How many are left, when the shop counts them. */
  left: number | null
}

/**
 * What a cart reminder says, by push and by email alike: the shops and lines the buyer can still
 * buy, shop by shop in the cart's order, what they cost now, and at most one line of good news.
 * It never carries a discount.
 */
export type CartReminderContent = {
  shops: string[]
  items: CartReminderItem[]
  /** A price that dropped since it was added, else an item with only a few left; null when neither. */
  good_news: string | null
  /** What the items cost now, before delivery. */
  total: number
  currency_code: string
}

const titleOf = ({ product_title, variant_title }: Pick<CartReminderLine, "product_title" | "variant_title">) => {
  const title = product_title ?? "An item"
  // A single variant is titled like its product.
  return variant_title && variant_title !== product_title ? `${title} (${variant_title})` : title
}

/** A line can be bought now when its shop takes orders, its offer has a price, and it isn't sold out. */
const buyable = (line: CartReminderLine): line is CartReminderLine & { unit_price: number } =>
  line.taking_orders && line.unit_price !== null && line.available_quantity !== 0

function goodNews(items: CartReminderItem[], currencyCode: string): string | null {
  const money = (amount: number) => formatMoney(amount, currencyCode)
  const dropped = items.filter((i) => i.price_drop).sort((a, b) => b.price_drop! - a.price_drop!)[0]
  if (dropped) return `${dropped.title} is now ${money(dropped.unit_price)}, down from ${money(dropped.unit_price + dropped.price_drop!)}.`
  const low = items.filter((i) => stockLeftLabel(i.left)).sort((a, b) => a.left! - b.left!)[0]
  return low ? `${stockLeftLabel(low.left)} of ${low.title}.` : null
}

/**
 * What to remind the buyer of their cart with: the lines they can buy now and the good news
 * about them. Null when nothing in the cart can be bought now, so no reminder goes.
 */
export function cartReminderContent(lines: CartReminderLine[], currencyCode: string): CartReminderContent | null {
  const items = lines.filter(buyable).map((line): CartReminderItem => {
    const quantity = line.available_quantity === null ? line.quantity : Math.min(line.quantity, line.available_quantity)
    return {
      line_item_id: line.line_item_id,
      shop: line.shop,
      title: titleOf(line),
      quantity,
      unit_price: line.unit_price,
      total: line.unit_price * quantity,
      price_drop: line.unit_price < line.added_unit_price ? line.added_unit_price - line.unit_price : null,
      left: line.available_quantity,
    }
  })
  if (!items.length) return null
  return {
    shops: [...new Set(items.map((i) => i.shop))],
    items,
    good_news: goodNews(items, currencyCode),
    total: items.reduce((sum, i) => sum + i.total, 0),
    currency_code: currencyCode,
  }
}

/** "Mama Put Groceries", or "Mama Put Groceries and 2 more shops". */
function shopsNamed([first, ...others]: string[]) {
  if (!others.length) return first
  return `${first} and ${others.length} more ${others.length === 1 ? "shop" : "shops"}`
}

/** Two items are named; more are counted, to keep the push short. */
function itemsNamed(items: CartReminderItem[]) {
  const [a, b, ...rest] = items.map((i) => i.title)
  if (!b) return `${a} is`
  return rest.length ? `${a}, ${b} and ${rest.length} more are` : `${a} and ${b} are`
}

/** The push reminding the buyer of their cart (#137): the shops, the top items, and the good news. Tapping it opens the cart. */
export function cartReminderPush(content: CartReminderContent): BuyerPush {
  return {
    title: `Your items from ${shopsNamed(content.shops)}`,
    body: [`${itemsNamed(content.items)} still in your cart.`, content.good_news].filter(Boolean).join(" "),
  }
}
