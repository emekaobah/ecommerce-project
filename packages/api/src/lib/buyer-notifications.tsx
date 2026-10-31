import {
  addressLines,
  buyerStatusPush,
  CART_REMINDER_FROM,
  cartReminderPush,
  collectByLabel,
  courierChangedPush,
  deliveryEstimate,
  holdReminderPush,
  itemsRemovedPush,
  notCollectedPush,
  openingHoursLines,
  orderCollectedPush,
  notPlacedPush,
  appIdentity,
  refundAccountPush,
  refundByHandPush,
  refundCompletedPush,
  openingLabel,
  orderCancelledPush,
  orderConfirmedPush,
  orderNumber,
  PRODUCT_NAME,
  shopStatus,
  type FulfilmentState,
  type HoldReminder,
  type RefundAccountReminder,
  type RemovedItem,
  type RefundNotice,
  type StoredAddress,
} from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { ReactElement } from "react"
import { CartReminderEmail } from "../emails/cart-reminder"
import { CheckoutNotPlacedEmail } from "../emails/checkout-not-placed"
import { CollectedReceiptEmail } from "../emails/collected-receipt"
import { CourierChangedEmail } from "../emails/courier-changed"
import { DeliveryReceiptEmail } from "../emails/delivery-receipt"
import { OrderCancelledEmail } from "../emails/order-cancelled"
import { OrderConfirmationEmail } from "../emails/order-confirmation"
import { NotCollectedEmail } from "../emails/not-collected"
import type { EmailCollectionPlace, EmailShopOrder } from "../emails/parts"
import { PickupReminderEmail } from "../emails/pickup-reminder"
import { ReadyForPickupEmail } from "../emails/ready-for-pickup"
import { RefundAccountEmail } from "../emails/refund-account"
import { RefundByHandEmail } from "../emails/refund-by-hand"
import { renderEmail } from "../emails/render"
import { PUSH_TOKEN_MODULE, type PushTokenModuleService } from "../modules/push-token"
import { SHIPBUBBLE_TIMEZONE } from "../modules/shipbubble"
import type { CartReminder } from "./cart-reminders"
import { backendUrl } from "./backend-url"
import { retrieveBuyerOrderGroup, type BuyerOrder, type BuyerOrderGroup } from "./buyer-orders"
import { sendEmail } from "./email"
import { fulfilmentService, fulfilmentsOf, switchedFrom, type Picks } from "./order-fulfilment"
import { needsAttentionSince } from "./owed-refunds"
import { perishableProductIds } from "./perishable"
import { NOT_COLLECTED_NOTE } from "./pickup-hold"
import { pushToDevices } from "./push-devices"
import { shopHoursOf } from "./shop-hours"
import type { StoredNotPlaced } from "./unplaced-checkout"
import { unsubscribeLink } from "./unsubscribe"

// What buyers are told about their orders (#5): a confirmation once their checkout is paid and
// a receipt once a shop's order is delivered, each by email and push, and a push as each shop's
// order moves on. A pickup order (#33) is also emailed once Ready, reminded half-way through
// its hold and on its last day, and sent a receipt once collected or told what is refunded once
// not collected, each by email and push. Tapping a push opens the checkout's order screen in the
// buyer app.

type Scope = Pick<MedusaContainer, "resolve">

/** A checkout as its buyer is told about it: their order group, and what the emails need besides. */
type BuyerCheckout = {
  customer_id: string
  group: BuyerOrderGroup
  /**
   * The checkout's number ("OJ-12", `orderNumber`): every email and push names the buyer's order
   * by it, as the buyer app does (#97), never by a shop's order's own `display_id`.
   */
  number: string
  /** Where the confirmation and receipts go: the email the buyer checked out with. */
  email: string | null
  address: string[]
  /** Each shop's order's delivery fee, by order id. */
  delivery: Map<string, number>
}

async function buyerCheckout(scope: Scope, groupId: string): Promise<BuyerCheckout | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order_group", fields: ["id", "customer_id"], filters: { id: groupId } })
  const customerId = (data[0] as unknown as { customer_id?: string | null } | undefined)?.customer_id
  if (!customerId) return null
  const group = await retrieveBuyerOrderGroup(scope, customerId, groupId)
  if (!group.orders.length) return null
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "email", "shipping_total", "shipping_address.*"],
    filters: { id: group.orders.map((o) => o.id) },
  })
  const rows = orders as unknown as { id: string; email?: string | null; shipping_total: unknown; shipping_address?: StoredAddress | null }[]
  const shipping = rows.find((o) => o.shipping_address)?.shipping_address
  const lines = shipping ? addressLines(shipping) : null
  return {
    customer_id: customerId,
    group,
    number: orderNumber(group.display_id),
    email: rows.find((o) => o.email)?.email ?? null,
    address: lines ? [lines.name, lines.place, ...(lines.landmark ? [lines.landmark] : [])].filter(Boolean) : [],
    delivery: new Map(rows.map((o) => [o.id, Number(o.shipping_total ?? 0)])),
  }
}

/** A shop's order as its buyer is told about it, and the checkout it was part of. */
async function buyerOrder(scope: Scope, orderId: string): Promise<{ checkout: BuyerCheckout; order: BuyerOrder } | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order_group_order", fields: ["order_group_id"], filters: { order_id: orderId } })
  const groupId = (data[0] as unknown as { order_group_id: string } | undefined)?.order_group_id
  const checkout = groupId ? await buyerCheckout(scope, groupId) : null
  const order = checkout?.group.orders.find((o) => o.id === orderId)
  return checkout && order ? { checkout, order } : null
}

async function buyerDevices(scope: Scope, customerId: string): Promise<string[]> {
  const tokens = await scope.resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE).listPushTokens({ actor_type: "customer", actor_id: customerId })
  return tokens.map((t) => t.token)
}

/** The buyer app's screen for a checkout, which a buyer push opens. */
const orderScreen = (groupId: string) => `/order/${groupId}`

const emailOrder = (order: BuyerOrder, delivery: Map<string, number>): EmailShopOrder => ({
  id: order.id,
  shop: order.seller.name,
  lines: order.items.map((item) => ({
    id: item.id,
    title: item.product_title ?? "Item",
    variant: item.variant_title,
    quantity: item.quantity,
    total: item.total,
  })),
  delivery: order.fulfilment.method === "pickup" ? null : (delivery.get(order.id) ?? 0),
  paid: order.paid_total,
})

/** Where to collect a pickup order, as its emails give it; null for a delivered order. */
function emailCollectionPlace(order: BuyerOrder): EmailCollectionPlace | null {
  const place = order.pickup
  if (!place) return null
  const { address_1, address_2, city, landmark } = place.address
  return {
    address: [order.seller.name, [address_1, address_2, city].filter(Boolean).join(", "), landmark].flatMap((line) => (line ? [line] : [])),
    instructions: place.instructions || null,
    phone: place.phone,
    hours: place.weekly ? openingHoursLines(place.weekly) : [],
  }
}

/** The data a buyer push about one of their orders carries: the screen it opens, and the order. */
const orderPushData = (checkout: BuyerCheckout, orderId: string) => ({
  url: orderScreen(checkout.group.id),
  order_group_id: checkout.group.id,
  order_id: orderId,
})

/**
 * Emails the buyer, once per `key` however often it is asked. Logged, not thrown, when it can't
 * be sent: the buyer still has the push and the app.
 */
async function emailBuyer(
  scope: Scope,
  to: string | null,
  email: { template: string; subject: string; body: ReactElement; key: string; headers?: Record<string, string> }
) {
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  if (!to) {
    logger.warn(`Not sending ${email.key}: the order has no email address`)
    return
  }
  const { html, text } = await renderEmail(email.body)
  await sendEmail(scope, {
    to,
    template: email.template,
    content: { subject: email.subject, html, text },
    idempotency_key: email.key,
    about: email.key,
    ...(email.headers && { provider_data: { headers: email.headers } }),
  })
}

/**
 * Confirms a paid checkout to its buyer (#5), by email and on each of their devices: its orders,
 * one per shop, what was paid and where it is going. A shop closed at checkout (outside its
 * hours, ADR 0004) prepares its order when it opens, and the confirmation says when.
 */
export async function confirmCheckout(scope: Scope, groupId: string, now = new Date()): Promise<void> {
  const checkout = await buyerCheckout(scope, groupId)
  if (!checkout) return
  const { group, delivery } = checkout
  const hours = await shopHoursOf(scope, group.orders.map((o) => o.seller.id), now)
  const orders = group.orders.map((order) => {
    const shop = hours.get(order.seller.id)
    const status = shop ? shopStatus(shop, now) : null
    const opens = status?.state === "closed" && status.opens_at ? openingLabel(status.opens_at, now, shop!.time_zone) : null
    return { ...emailOrder(order, delivery), opens }
  })
  const currency = group.orders[0]!.currency_code
  const push = orderConfirmedPush({ number: checkout.number, shops: orders.map((o) => ({ name: o.shop, opens: o.opens })) })
  await Promise.all([
    emailBuyer(scope, checkout.email, {
      template: "order-confirmation",
      subject: `Your ${PRODUCT_NAME} order ${checkout.number} is confirmed`,
      body: <OrderConfirmationEmail number={checkout.number} currency={currency} orders={orders} address={checkout.address} />,
      key: `order-confirmation:${group.id}`,
    }),
    pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
      template: "buyer-order-confirmed",
      ...push,
      data: { url: orderScreen(group.id), order_group_id: group.id },
      idempotencyKey: (to) => `buyer-order-confirmed:${group.id}:${to}`,
      about: `the confirmation of order group ${group.id}`,
    }),
  ])
}

/**
 * Pushes the buyer that one of their orders reached `state` (#5), on each of their devices,
 * when it is a state they are told about (`buyerStatusPush`).
 */
export async function pushOrderState(scope: Scope, orderId: string, state: FulfilmentState): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const { checkout, order } = found
  const push = buyerStatusPush(state, {
    number: checkout.number,
    shop: order.seller.name,
    rejected_by: order.fulfilment.rejected_by,
    pickup: order.pickup,
  })
  if (!push) return
  const record = (await fulfilmentsOf(scope, [orderId])).get(orderId)
  // A label booked with another courier than the buyer chose is told by `tellCourierChanged` instead (#19).
  if (state === "label_booked" && record?.shipment && switchedFrom(record.shipment)) return
  // An order can reach a state again (a courier label rebooked after the shipper cancelled it):
  // the device is told each time, once.
  const reachedAt = record?.reached?.[state] ?? ""
  await pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
    template: `buyer-order-${state.replaceAll("_", "-")}`,
    ...push,
    data: orderPushData(checkout, orderId),
    idempotencyKey: (to) => `buyer-order-${state}:${orderId}:${reachedAt}:${to}`,
    about: `${state} for order ${orderId}`,
  })
}

/**
 * Tells the buyer, by push and email, that their order's label was booked with another courier
 * than they chose at checkout (#19), and when it now arrives, even when no later than before.
 * Once per booking: a rebook with another courier is told again.
 */
export async function tellCourierChanged(scope: Scope, orderId: string): Promise<void> {
  const shipment = (await fulfilmentsOf(scope, [orderId])).get(orderId)?.shipment
  const chosen = shipment && switchedFrom(shipment)
  if (!shipment || !chosen) return
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const { checkout, order } = found
  // Days counted as the buyer's order shows them (`buyerDelivery`).
  const arrives = deliveryEstimate(shipment.delivery_eta_time, new Date(), SHIPBUBBLE_TIMEZONE)
  const notice = { number: checkout.number, shop: order.seller.name, courier: shipment.courier.courier_name, arrives }
  const key = `courier-changed:${orderId}:${shipment.waybill}`
  await Promise.all([
    emailBuyer(scope, checkout.email, {
      template: "courier-changed",
      subject: `Your ${PRODUCT_NAME} order ${checkout.number} has a new courier`,
      body: <CourierChangedEmail {...notice} chosen={chosen.courier_name} />,
      key,
    }),
    pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
      template: "buyer-courier-changed",
      ...courierChangedPush(notice),
      data: orderPushData(checkout, orderId),
      idempotencyKey: (to) => `buyer-${key}:${to}`,
      about: `the new courier of order ${orderId}`,
    }),
  ])
}

/** The day of `at` where the order's shop is, as the buyer reads it: "Thursday 15 October". */
async function shopDay(scope: Scope, order: BuyerOrder, at: string | Date) {
  const hours = (await shopHoursOf(scope, [order.seller.id])).get(order.seller.id)
  return new Intl.DateTimeFormat("en-GB", { timeZone: hours?.time_zone, weekday: "long", day: "numeric", month: "long" }).format(new Date(at))
}

/** Emails the buyer their receipt for a shop's order once it is delivered (#5). */
export async function emailDeliveryReceipt(scope: Scope, orderId: string): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const { checkout, order } = found
  const record = (await fulfilmentsOf(scope, [orderId])).get(orderId)
  const deliveredAt = record?.reached?.delivered ?? record?.payout_eligible_at ?? new Date()
  const delivered_on = await shopDay(scope, order, deliveredAt)
  await emailBuyer(scope, checkout.email, {
    template: "delivery-receipt",
    subject: `Your ${PRODUCT_NAME} receipt: order ${checkout.number} from ${order.seller.name}`,
    body: (
      <DeliveryReceiptEmail
        number={checkout.number}
        currency={order.currency_code}
        order={emailOrder(order, checkout.delivery)}
        refunded={order.refund?.amount ?? 0}
        delivered_on={delivered_on}
        address={checkout.address}
      />
    ),
    key: `delivery-receipt:${orderId}`,
  })
}

/**
 * Pushes the buyer that a shop removed items it didn't have from their order (#22), and what
 * they are refunded for them: `order_fulfilment.items_removed`'s data.
 */
export async function pushItemsRemoved(
  scope: Scope,
  { id: orderId, amount, removed, at }: { id: string; amount: number; removed: Picks; at: string }
): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const { checkout, order } = found
  const items = Object.entries(removed).flatMap(([id, quantity]) => {
    const item = order.items.find((i) => i.id === id)
    return item && quantity > 0 ? [{ title: item.product_title ?? "Item", quantity }] : []
  })
  const push = itemsRemovedPush({
    number: checkout.number,
    shop: order.seller.name,
    items,
    refund: amount,
    currency_code: order.currency_code,
  })
  await pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
    template: "buyer-order-items-removed",
    ...push,
    data: orderPushData(checkout, orderId),
    // Items can be removed from an order more than once: each removal is told once.
    idempotencyKey: (to) => `buyer-order-items-removed:${orderId}:${at}:${to}`,
    about: `the items removed from order ${orderId}`,
  })
}

/**
 * Tells the buyer, by push and email, that an accepted order was cancelled (#17), by its shop or
 * by Oja's team, why, and what they are refunded: `order_fulfilment.cancelled`'s data. Once per
 * order, however often it is asked.
 */
export async function tellOrderCancelled(scope: Scope, { id: orderId, amount }: { id: string; amount: number }): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  const cancellation = found?.order.fulfilment.cancellation
  if (!found || !cancellation) return
  const { checkout, order } = found
  const notice = { number: checkout.number, shop: order.seller.name, cancellation, refund: amount, currency_code: order.currency_code }
  const key = `order-cancelled:${orderId}`
  await Promise.all([
    emailBuyer(scope, checkout.email, {
      template: "order-cancelled",
      subject: `Your ${PRODUCT_NAME} order ${checkout.number} from ${order.seller.name} was cancelled`,
      body: <OrderCancelledEmail {...notice} />,
      key,
    }),
    pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
      template: "buyer-order-cancelled",
      ...orderCancelledPush(notice),
      data: orderPushData(checkout, orderId),
      idempotencyKey: (to) => `buyer-${key}:${to}`,
      about: `the cancellation of order ${orderId}`,
    }),
  ])
}

/**
 * Tells the buyer, by push and email, that Oja's team is sending a refund of their order by
 * hand (#16): Paystack can't make it. Once per order and amount, however often it is asked.
 */
export async function tellRefundByHand(scope: Scope, { order_id: orderId, amount }: { order_id: string; amount: number }): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const { checkout, order } = found
  const refund: RefundNotice = { number: checkout.number, shop: order.seller.name, amount, currency_code: order.currency_code }
  const key = `refund-by-hand:${orderId}:${amount}`
  await Promise.all([
    emailBuyer(scope, checkout.email, {
      template: "refund-by-hand",
      subject: `Your ${PRODUCT_NAME} refund for order ${checkout.number}`,
      body: <RefundByHandEmail refund={refund} />,
      key,
    }),
    pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
      template: "buyer-refund-by-hand",
      ...refundByHandPush(refund),
      data: orderPushData(checkout, orderId),
      idempotencyKey: (to) => `buyer-${key}:${to}`,
      about: `the refund owed on order ${orderId}`,
    }),
  ])
}

/**
 * Whether a refund is the one a pickup order's hold expiry made (#32): its buyer was told what
 * it refunds (`tellNotCollected`), in place of its own push. Any other refund of the order, such
 * as Oja's team refunding the fresh items it kept, is pushed as usual.
 */
async function isNotCollectedRefund(scope: Scope, refund: { refund_id?: string | null }): Promise<boolean> {
  if (!refund.refund_id) return false
  const [made] = await scope.resolve(Modules.PAYMENT).listRefunds({ id: refund.refund_id }, { select: ["id", "note"] })
  return made?.note === NOT_COLLECTED_NOTE
}

/** Pushes the buyer that a refund of their order has completed: Paystack processed it. */
export async function pushRefundCompleted(scope: Scope, refundId: string): Promise<void> {
  const [refund] = await fulfilmentService(scope).listOrderRefunds({ id: refundId })
  const found = refund?.order_id ? await buyerOrder(scope, refund.order_id) : null
  if (!refund || !found || (await isNotCollectedRefund(scope, refund))) return
  const { checkout, order } = found
  const push = refundCompletedPush({
    number: checkout.number,
    shop: order.seller.name,
    amount: Number(refund.amount),
    currency_code: refund.currency_code,
  })
  await pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
    template: "buyer-refund-completed",
    ...push,
    data: orderPushData(checkout, order.id),
    idempotencyKey: (to) => `buyer-refund-completed:${refund.id}:${to}`,
    about: `the refund ${refund.id}`,
  })
}

/** The buyer app's screen for a refund, where they add the bank account it needs (#13). */
export const refundScreen = (refundId: string) => `/refund/${refundId}`

/** The order refund, and the buyer's order it refunds; null for a refund of no order, or a buyer gone. */
async function refundOfBuyerOrder(scope: Scope, refundId: string) {
  const [refund] = await fulfilmentService(scope).listOrderRefunds({ id: refundId })
  const found = refund?.order_id ? await buyerOrder(scope, refund.order_id) : null
  return refund && found ? { refund, ...found } : null
}

/**
 * Asks the buyer, by push and email, for a bank account to receive a refund Paystack couldn't
 * return to their card (#13), or reminds them. Each opens the refund's screen in the app. Once
 * per refund each time it needs attention, and once per reminder.
 */
export async function askForRefundAccount(scope: Scope, refundId: string, reminder?: RefundAccountReminder & { nth: number }): Promise<void> {
  const found = await refundOfBuyerOrder(scope, refundId)
  if (!found) return
  const { refund, checkout, order } = found
  const notice: RefundNotice = { number: checkout.number, shop: order.seller.name, amount: Number(refund.amount), currency_code: refund.currency_code }
  const kind = reminder ? `refund-account-reminder-${reminder.nth}` : "refund-account"
  const key = `${kind}:${refund.id}:${needsAttentionSince(refund)}`
  const url = refundScreen(refund.id)
  const push = refundAccountPush(notice, reminder)
  await Promise.all([
    emailBuyer(scope, checkout.email, {
      template: "refund-account",
      subject: reminder ? `Reminder: add a bank account for your ${PRODUCT_NAME} refund` : `Add a bank account for your ${PRODUCT_NAME} refund`,
      body: <RefundAccountEmail refund={notice} link={`${appIdentity("buyer").scheme}:/${url}`} reminder={reminder} />,
      key,
    }),
    pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
      template: "buyer-refund-account",
      ...push,
      data: { url, order_group_id: checkout.group.id, order_id: order.id, refund_id: refund.id },
      idempotencyKey: (to) => `buyer-${key}:${to}`,
      about: `the bank account refund ${refund.id} needs`,
    }),
  ])
}

/** The buyer app's Cart tab, which a cart reminder opens. */
const CART_SCREEN = "/cart"

/**
 * Reminds the buyer of the cart they left (#137) on each of their devices, once per reminder
 * however often it is asked: its shops, top items and good news. Tapping it opens the Cart tab;
 * `from` marks an open from a reminder (story 38).
 */
export async function pushCartReminder(scope: Scope, reminder: CartReminder): Promise<void> {
  await pushToDevices(scope, await buyerDevices(scope, reminder.customer_id), {
    template: "buyer-cart-reminder",
    ...cartReminderPush(reminder.content),
    data: { url: CART_SCREEN, cart_id: reminder.cart_id, from: CART_REMINDER_FROM },
    idempotencyKey: (to) => `buyer-cart-reminder:${reminder.key}:${to}`,
    about: `the reminder of cart ${reminder.cart_id}`,
  })
}

/**
 * Emails the buyer the reminder of the cart they left (#139), once per reminder however often it
 * is asked: what the push says, the items and what they cost now, and a button that opens the
 * cart in the app (through an https page, api/open/cart, which webmail doesn't strip). It carries a signed link that turns these emails off, also in the
 * `List-Unsubscribe` headers mail apps offer one-click unsubscribe from. Without a signing secret
 * for that link it isn't sent, and that is logged.
 */
export async function emailCartReminder(scope: Scope, reminder: CartReminder): Promise<void> {
  const unsubscribe = unsubscribeLink(reminder.customer_id, "cart_reminder_email")
  if (!unsubscribe) {
    scope.resolve(ContainerRegistrationKeys.LOGGER).warn(`Not emailing the reminder of cart ${reminder.cart_id}: UNSUBSCRIBE_SECRET isn't set`)
    return
  }
  await emailBuyer(scope, reminder.email, {
    template: "cart-reminder",
    subject: cartReminderPush(reminder.content).title,
    body: <CartReminderEmail content={reminder.content} cartLink={`${backendUrl()}/open/cart?from=${CART_REMINDER_FROM}`} unsubscribeLink={unsubscribe} />,
    key: `buyer-cart-reminder-email:${reminder.key}`,
    headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  })
}

/** The buyer app's checkout for a cart, which a push about a cart that wasn't placed opens. */
const checkoutScreen = (cartId: string) => `/checkout?cartId=${cartId}`

/** A paid cart that failed to become orders (#38), as the buyer is told about it. */
export type CartNotPlaced = {
  cart_id: string
  customer_id: string | null
  email: string | null
  not_placed: StoredNotPlaced
}

/**
 * Tells the buyer, by email and on each of their devices, that their paid cart failed to become
 * orders (#38): why, what they were refunded (it can take a few days to reach the card), and
 * what changed in the cart for them to pay again.
 */
export async function tellCartNotPlaced(scope: Scope, { cart_id, customer_id, email, not_placed }: CartNotPlaced): Promise<void> {
  const { currency_code: currency, changes, refund_id } = not_placed
  const push = notPlacedPush(not_placed, currency)
  await Promise.all([
    emailBuyer(scope, email, {
      template: "checkout-not-placed",
      subject: `Your ${PRODUCT_NAME} order wasn't placed: you've been refunded`,
      body: <CheckoutNotPlacedEmail not_placed={not_placed} currency={currency} changes={changes} />,
      key: `checkout-not-placed:${refund_id}`,
    }),
    customer_id &&
      pushToDevices(scope, await buyerDevices(scope, customer_id), {
        template: "buyer-checkout-not-placed",
        ...push,
        data: { url: checkoutScreen(cart_id), cart_id },
        idempotencyKey: (to) => `buyer-checkout-not-placed:${refund_id}:${to}`,
        about: `cart ${cart_id} not being placed`,
      }),
  ])
}

/**
 * Tells the buyer their pickup order is Ready for pickup (#12, #33): the push (`pushOrderState`)
 * and an email with the code, where to collect, the shop's hours and when to collect by. Once
 * each, however often it is asked.
 */
export async function tellReadyForPickup(scope: Scope, orderId: string): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const { checkout, order } = found
  const place = emailCollectionPlace(order)
  const code = order.pickup?.code
  const collectBy = order.fulfilment.collect_by
  await Promise.all([
    pushOrderState(scope, orderId, "ready_for_pickup"),
    // Collected already: the code is spent, and the receipt follows.
    place &&
      code &&
      emailBuyer(scope, checkout.email, {
        template: "ready-for-pickup",
        subject: `Your ${PRODUCT_NAME} order ${checkout.number} from ${order.seller.name} is ready for pickup`,
        body: (
          <ReadyForPickupEmail
            currency={order.currency_code}
            order={emailOrder(order, checkout.delivery)}
            code={code}
            place={place}
            collect_by={collectBy ? collectByLabel(collectBy.at, new Date(), collectBy.time_zone) : null}
          />
        ),
        key: `ready-for-pickup:${orderId}`,
      }),
  ])
}

/**
 * Reminds the buyer, by push and email, to collect their pickup order (#33): half-way through
 * its hold, or on its last day, when to collect by (as of `at`, when the reminder was due) and
 * what happens if they don't. Nothing once it is no longer Ready for pickup. Once each.
 */
export async function remindOfPickupHold(scope: Scope, { id: orderId, reminder, at }: { id: string; reminder: HoldReminder; at: string }) {
  const found = await buyerOrder(scope, orderId)
  const collectBy = found?.order.fulfilment.collect_by
  const place = found && emailCollectionPlace(found.order)
  if (found?.order.fulfilment.state !== "ready_for_pickup" || !collectBy || !place) return
  const { checkout, order } = found
  const onOrder = order.items.filter((i) => i.quantity > 0 && i.product_id).map((i) => i.product_id!)
  const notice = {
    number: checkout.number,
    shop: order.seller.name,
    reminder,
    collect_by: collectByLabel(collectBy.at, new Date(at), collectBy.time_zone),
    perishable: (await perishableProductIds(scope, onOrder)).size > 0,
  }
  const key = `pickup-${reminder.replace("_", "-")}:${orderId}`
  await Promise.all([
    emailBuyer(scope, checkout.email, {
      template: "pickup-reminder",
      subject:
        reminder === "last_day"
          ? `Last day to collect your ${PRODUCT_NAME} order ${checkout.number}`
          : `Reminder: your ${PRODUCT_NAME} order ${checkout.number} is waiting for you`,
      body: <PickupReminderEmail {...notice} place={place} />,
      key,
    }),
    pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
      template: "buyer-pickup-reminder",
      ...holdReminderPush(notice),
      data: orderPushData(checkout, orderId),
      idempotencyKey: (to) => `buyer-${key}:${to}`,
      about: `the ${reminder} reminder of pickup order ${orderId}`,
    }),
  ])
}

/** Sends the buyer, by email with a push, their receipt for a pickup order they collected (#33). Once. */
export async function tellOrderCollected(scope: Scope, orderId: string): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  const record = (await fulfilmentsOf(scope, [orderId])).get(orderId)
  const collection = record?.fulfilment.state === "collected" ? record.fulfilment.collection : null
  if (!found || !collection) return
  const { checkout, order } = found
  await Promise.all([
    emailBuyer(scope, checkout.email, {
      template: "collected-receipt",
      subject: `Your ${PRODUCT_NAME} receipt: order ${checkout.number} from ${order.seller.name}`,
      body: (
        <CollectedReceiptEmail
          number={checkout.number}
          currency={order.currency_code}
          order={emailOrder(order, checkout.delivery)}
          refunded={order.refund?.amount ?? 0}
          collected_on={await shopDay(scope, order, collection.at)}
          collected_by={collection.collectedBy}
        />
      ),
      key: `collected-receipt:${orderId}`,
    }),
    pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
      template: "buyer-order-collected",
      ...orderCollectedPush({ number: checkout.number, shop: order.seller.name }),
      data: orderPushData(checkout, orderId),
      idempotencyKey: (to) => `buyer-order-collected:${orderId}:${to}`,
      about: `the receipt of order ${orderId}`,
    }),
  ])
}

/**
 * Tells the buyer, by push and email, that their pickup order wasn't collected in time (#33,
 * #32): what they are refunded, its non-perishable lines, and the fresh lines that aren't:
 * `order_fulfilment.not_collected`'s data. The refund it tells of isn't pushed besides when it
 * completes (`pushRefundCompleted`). Once.
 */
export async function tellNotCollected(
  scope: Scope,
  { id: orderId, amount, refunded, kept }: { id: string; amount: number; refunded: Picks; kept: Picks }
): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const { checkout, order } = found
  // The lines refunded have left the order (#32): their titles are on the line items still.
  const lines = await scope
    .resolve(Modules.ORDER)
    .listOrderLineItems({ id: Object.keys({ ...refunded, ...kept }) }, { select: ["id", "product_title"] })
  const named = (units: Picks): RemovedItem[] =>
    Object.entries(units).flatMap(([id, quantity]) => {
      const line = lines.find((l) => l.id === id)
      return line && quantity > 0 ? [{ title: line.product_title ?? "Item", quantity }] : []
    })
  const notice = {
    number: checkout.number,
    shop: order.seller.name,
    refund: amount,
    currency_code: order.currency_code,
    refunded: named(refunded),
    kept: named(kept),
  }
  const key = `not-collected:${orderId}`
  await Promise.all([
    emailBuyer(scope, checkout.email, {
      template: "not-collected",
      subject: `Your ${PRODUCT_NAME} order ${checkout.number} from ${order.seller.name} wasn't collected`,
      body: <NotCollectedEmail {...notice} />,
      key,
    }),
    pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
      template: "buyer-order-not-collected",
      ...notCollectedPush(notice),
      data: orderPushData(checkout, orderId),
      idempotencyKey: (to) => `buyer-${key}:${to}`,
      about: `order ${orderId} not being collected`,
    }),
  ])
}
