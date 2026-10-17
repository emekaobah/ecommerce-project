import {
  addressLines,
  buyerStatusPush,
  itemsRemovedPush,
  refundByHandPush,
  refundCompletedPush,
  openingLabel,
  orderConfirmedPush,
  PRODUCT_NAME,
  shopStatus,
  type FulfilmentState,
  type StoredAddress,
} from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ReactElement } from "react"
import { DeliveryReceiptEmail } from "../emails/delivery-receipt"
import { OrderConfirmationEmail } from "../emails/order-confirmation"
import type { EmailShopOrder } from "../emails/parts"
import { RefundByHandEmail } from "../emails/refund-by-hand"
import { renderEmail } from "../emails/render"
import { PUSH_TOKEN_MODULE, type PushTokenModuleService } from "../modules/push-token"
import { retrieveBuyerOrderGroup, type BuyerOrder, type BuyerOrderGroup } from "./buyer-orders"
import { sendEmail } from "./email"
import { fulfilmentService, fulfilmentsOf, type Picks } from "./order-fulfilment"
import { pushToDevices } from "./push-devices"
import { shopHoursOf } from "./shop-hours"

// What buyers are told about their orders (#5): a confirmation once their checkout is paid and
// a receipt once a shop's order is delivered, each by email and push, and a push as each shop's
// order moves on. Tapping a push opens the checkout's order screen in the buyer app.

type Scope = Pick<MedusaContainer, "resolve">

/** A checkout as its buyer is told about it: their order group, and what the emails need besides. */
type BuyerCheckout = {
  customer_id: string
  group: BuyerOrderGroup
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
  display_id: order.display_id,
  shop: order.seller.name,
  lines: order.items.map((item) => ({
    id: item.id,
    title: item.product_title ?? "Item",
    variant: item.variant_title,
    quantity: item.quantity,
    total: item.total,
  })),
  delivery: delivery.get(order.id) ?? 0,
  paid: order.paid_total,
})

/**
 * Emails the buyer, once per `key` however often it is asked. Logged, not thrown, when it can't
 * be sent: the buyer still has the push and the app.
 */
async function emailBuyer(scope: Scope, to: string | null, email: { template: string; subject: string; body: ReactElement; key: string }) {
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
  const push = orderConfirmedPush({ display_id: group.display_id, shops: orders.map((o) => ({ name: o.shop, opens: o.opens })) })
  await Promise.all([
    emailBuyer(scope, checkout.email, {
      template: "order-confirmation",
      subject: `Your ${PRODUCT_NAME} order #${group.display_id} is confirmed`,
      body: <OrderConfirmationEmail display_id={group.display_id} currency={currency} orders={orders} address={checkout.address} />,
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
    display_id: order.display_id,
    shop: order.seller.name,
    rejected_by: order.fulfilment.rejected_by,
    pickup: order.pickup,
  })
  if (!push) return
  // An order can reach a state again (a courier label rebooked after the shipper cancelled it):
  // the device is told each time, once.
  const reachedAt = (await fulfilmentsOf(scope, [orderId])).get(orderId)?.reached?.[state] ?? ""
  await pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
    template: `buyer-order-${state.replaceAll("_", "-")}`,
    ...push,
    data: { url: orderScreen(checkout.group.id), order_group_id: checkout.group.id, order_id: orderId },
    idempotencyKey: (to) => `buyer-order-${state}:${orderId}:${reachedAt}:${to}`,
    about: `${state} for order ${orderId}`,
  })
}

/** Emails the buyer their receipt for a shop's order once it is delivered (#5). */
export async function emailDeliveryReceipt(scope: Scope, orderId: string): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const { checkout, order } = found
  const record = (await fulfilmentsOf(scope, [orderId])).get(orderId)
  const deliveredAt = record?.reached?.delivered ?? record?.payout_eligible_at ?? new Date()
  const hours = (await shopHoursOf(scope, [order.seller.id])).get(order.seller.id)
  const delivered_on = new Intl.DateTimeFormat("en-GB", {
    timeZone: hours?.time_zone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(deliveredAt))
  await emailBuyer(scope, checkout.email, {
    template: "delivery-receipt",
    subject: `Your ${PRODUCT_NAME} receipt: order #${order.display_id} from ${order.seller.name}`,
    body: (
      <DeliveryReceiptEmail
        group_display_id={checkout.group.display_id}
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
    display_id: order.display_id,
    shop: order.seller.name,
    items,
    refund: amount,
    currency_code: order.currency_code,
  })
  await pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
    template: "buyer-order-items-removed",
    ...push,
    data: { url: orderScreen(checkout.group.id), order_group_id: checkout.group.id, order_id: orderId },
    // Items can be removed from an order more than once: each removal is told once.
    idempotencyKey: (to) => `buyer-order-items-removed:${orderId}:${at}:${to}`,
    about: `the items removed from order ${orderId}`,
  })
}

/**
 * Tells the buyer, by push and email, that Oja's team is sending a refund of their order by
 * hand (#16): Paystack can't make it. Once per order and amount, however often it is asked.
 */
export async function tellRefundByHand(scope: Scope, { order_id: orderId, amount }: { order_id: string; amount: number }): Promise<void> {
  const found = await buyerOrder(scope, orderId)
  if (!found) return
  const { checkout, order } = found
  const details = { display_id: order.display_id, shop: order.seller.name, amount, currency_code: order.currency_code }
  const key = `refund-by-hand:${orderId}:${amount}`
  await Promise.all([
    emailBuyer(scope, checkout.email, {
      template: "refund-by-hand",
      subject: `Your ${PRODUCT_NAME} refund for order #${order.display_id}`,
      body: <RefundByHandEmail display_id={order.display_id} shop={order.seller.name} currency={order.currency_code} amount={amount} />,
      key,
    }),
    pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
      template: "buyer-refund-by-hand",
      ...refundByHandPush(details),
      data: { url: orderScreen(checkout.group.id), order_group_id: checkout.group.id, order_id: orderId },
      idempotencyKey: (to) => `buyer-${key}:${to}`,
      about: `the refund owed on order ${orderId}`,
    }),
  ])
}

/** Pushes the buyer that a refund of their order has completed: Paystack processed it. */
export async function pushRefundCompleted(scope: Scope, refundId: string): Promise<void> {
  const [refund] = await fulfilmentService(scope).listOrderRefunds({ id: refundId })
  const found = refund?.order_id ? await buyerOrder(scope, refund.order_id) : null
  if (!refund || !found) return
  const { checkout, order } = found
  const push = refundCompletedPush({
    display_id: order.display_id,
    shop: order.seller.name,
    amount: Number(refund.amount),
    currency_code: refund.currency_code,
  })
  await pushToDevices(scope, await buyerDevices(scope, checkout.customer_id), {
    template: "buyer-refund-completed",
    ...push,
    data: { url: orderScreen(checkout.group.id), order_group_id: checkout.group.id, order_id: order.id },
    idempotencyKey: (to) => `buyer-refund-completed:${refund.id}:${to}`,
    about: `the refund ${refund.id}`,
  })
}
