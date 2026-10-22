import { isReceived } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, ProductStatus } from "@medusajs/framework/utils"
import { availableQuantities } from "./availability"
import { retrieveBuyerOrderGroup, type BuyerOrder, type BuyerOrderItem } from "./buyer-orders"
import { priceOffers } from "./listings"
import { isLive } from "./onboarding"
import { shopStatusesOf, type ShopStatusView } from "./shop-hours"

// Order again (#72): the buyer reorders one shop's part of an order they received. The preview
// shows each line's offer today, at today's price against what was paid and with what is left,
// and whether the shop takes orders now; the app then adds the ticked offers to the cart in one
// call (`POST /store/carts/:id/offer-lines`), which refuses as adding one offer does.

/** Why the shop takes no orders now: paused, closed for a date (ADR 0004), or no longer selling on Oja. */
export type NotTakingOrders = "paused" | "closed" | "left"

/** The line's offer today, in the order's region. */
export type OrderAgainOffer = {
  id: string
  unit_price: number
  /** The shop's normal price while it has a sale, as on the product page; null otherwise. */
  compare_at_unit_price: number | null
  /** How many can be ordered (0: sold out); null when the shop doesn't track its stock or takes backorders. */
  available_quantity: number | null
}

export type OrderAgainItem = Pick<
  BuyerOrderItem,
  "id" | "product_id" | "product_title" | "variant_id" | "variant_title" | "thumbnail"
> & {
  /** How many the buyer ordered, the ones the shop couldn't send included. */
  quantity: number
  paid_unit_price: number
  /** Null when the shop no longer sells it (or has left Oja). */
  offer: OrderAgainOffer | null
  /** Whether today's price differs from what was paid. */
  price_changed: boolean
  /** Why it can't be added: sold out, or no longer sold; null when it can. */
  unavailable: "sold_out" | "not_sold" | null
}

export type OrderAgain = {
  order_id: string
  seller: BuyerOrder["seller"]
  /** Open (with when it closes today), closed outside its hours (still orderable), or closed until it reopens, with its note; null once the shop has left Oja. */
  shop_status: ShopStatusView | null
  not_taking_orders: NotTakingOrders | null
  items: OrderAgainItem[]
}

type Scope = Pick<MedusaContainer, "resolve">

type OfferRow = {
  id: string
  seller_id: string
  variant_id: string
  product_variant?: { price_set?: { id: string } | null; product?: { status: string } | null } | null
}

/**
 * The preview of ordering one shop's part of the buyer's order group again. Another buyer's
 * group, or a shop not in it, is not found; an order not yet delivered or collected is refused.
 */
export async function orderAgainPreview(
  scope: MedusaContainer,
  customerId: string,
  groupId: string,
  sellerId: string
): Promise<OrderAgain> {
  const group = await retrieveBuyerOrderGroup(scope, customerId, groupId)
  const order = group.orders.find((o) => o.seller.id === sellerId)
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Shop ${sellerId} has no order in order group ${groupId}`)
  if (!isReceived(order.fulfilment.state)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "An order can be ordered again once it is delivered or collected.")
  }

  const live = await isLive(scope, sellerId)
  const status = live ? (await shopStatusesOf(scope, [sellerId])).get(sellerId)! : null
  const offers = live ? await todaysOffers(scope, order, sellerId) : new Map<string, OrderAgainOffer>()

  return {
    order_id: order.id,
    seller: order.seller,
    shop_status: status,
    not_taking_orders: !status ? "left" : status.orderable ? null : status.state === "closed_until" && status.reason === "pause" ? "paused" : "closed",
    items: order.items.map((item) => {
      const offer = (item.variant_id && offers.get(item.variant_id)) || null
      return {
        id: item.id,
        product_id: item.product_id,
        product_title: item.product_title,
        variant_id: item.variant_id,
        variant_title: item.variant_title,
        thumbnail: item.thumbnail,
        quantity: item.quantity + item.unavailable_quantity,
        paid_unit_price: item.unit_price,
        offer,
        price_changed: !!offer && offer.unit_price !== item.unit_price,
        unavailable: !offer ? "not_sold" : offer.available_quantity === 0 ? "sold_out" : null,
      }
    }),
  }
}

/** The shop's offers today of the order's variants, by variant: published and priced in the order's region. */
async function todaysOffers(scope: Scope, order: BuyerOrder, sellerId: string): Promise<Map<string, OrderAgainOffer>> {
  const variantIds = order.items.flatMap((i) => (i.variant_id ? [i.variant_id] : []))
  if (!variantIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data: offerRows }, { data: orders }] = await Promise.all([
    query.graph({
      entity: "offer",
      fields: ["id", "seller_id", "variant_id", "product_variant.price_set.id", "product_variant.product.status"],
      filters: { seller_id: sellerId, variant_id: variantIds },
    }),
    query.graph({ entity: "order", fields: ["id", "region_id"], filters: { id: order.id } }),
  ])
  const regionId = (orders[0] as { region_id: string | null } | undefined)?.region_id
  const published = (offerRows as unknown as OfferRow[]).filter((o) => o.product_variant?.product?.status === ProductStatus.PUBLISHED)
  if (!regionId || !published.length) return new Map()

  const [priced, available] = await Promise.all([
    priceOffers(scope as MedusaContainer, { id: regionId, currency_code: order.currency_code }, published),
    availableQuantities(scope, published.map((o) => o.id)),
  ])
  return new Map(
    priced.map((o) => {
      const unitPrice = Number(o.calculated_price.calculated_amount)
      const original = Number(o.calculated_price.original_amount ?? unitPrice)
      return [
        o.variant_id,
        {
          id: o.id,
          unit_price: unitPrice,
          compare_at_unit_price: original > unitPrice ? original : null,
          available_quantity: available.get(o.id) ?? null,
        },
      ]
    })
  )
}
