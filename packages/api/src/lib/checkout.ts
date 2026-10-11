import type { CreateAddressDTO, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  updateCartWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/medusa/core-flows"
import { addSellerShippingMethodToCartWorkflow } from "@mercurjs/core/workflows"
import {
  deliveryChoices,
  PERISHABLE_PICKUP_NOTE,
  PICKUP_HOLD_NOTICE,
  type DeliveryTag,
  type FulfilmentMethod,
  type LinePrice,
  type PriceChange,
} from "@oja/domain"
import { PAYSTACK_PROVIDER_ID, paystackClient } from "../modules/paystack"
import type { PaystackSessionData } from "../modules/paystack/service"
import { SHIPBUBBLE_PROVIDER_ID, SHIPBUBBLE_TIMEZONE, type ShipbubbleMethodData } from "../modules/shipbubble"
import { removeCartDeliveriesWorkflow } from "../workflows/checkout/remove-cart-deliveries"
import { retrieveCartBySeller, type CartSeller, type CartSellerGroup } from "./cart"
import { offerLinePrice } from "./cart-lines"
import {
  collectionPlacesOf,
  collectionPointsOf,
  isPickupMethod,
  PICKUP_METHOD_DATA,
  pickupOptionsBySeller,
  type CollectionPlace,
} from "./collection-point"
import { addressCodeOf, quoteBasis, quoteRates, ratesFor, regionTimeZone, samePlace, withAddressCode } from "./delivery"
import { closedShopError } from "./shop-hours"

// Checkout of a multi-shop cart (#16): the buyer's address, each shop's delivery, then a
// Paystack payment for the lot. Paystack's webhook completes the cart into an order group
// with one order per shop (docs/adr/0003-paystack-payments.md); the app polls the checkout
// until it has one. Delivery is quoted live by Shipbubble per shop (#23, `delivery.ts`).

export type CheckoutAddress = {
  first_name: string
  last_name: string
  address_1: string
  address_2?: string | null
  city: string
  province: string
  postal_code?: string | null
  country_code: string
  phone: string
  /**
   * `landmark`: directions for the rider; `latitude`/`longitude`: the pin the buyer confirmed;
   * `shipbubble_address_code`: Shipbubble's code once validated (ADR 0002).
   */
  metadata?: Record<string, unknown> | null
}

/** One courier rate a shop's delivery can go by. */
export type CheckoutDeliveryChoice = {
  id: string
  courier_name: string
  amount: number
  /** Shipbubble's wording, e.g. "Within 1 - 2 working days". */
  delivery_eta: string | null
  /** ISO 8601. */
  delivery_eta_time: string
  /** Where days are counted for "Arrives tomorrow": the courier's (Shipbubble's) timezone. */
  time_zone: string
  tags: DeliveryTag[]
}

export type CheckoutShipping = {
  shipping_option_id: string
  name: string
  amount: number
  /** The chosen `delivery_choices` entry. */
  choice_id: string
  delivery_eta_time: string
}

/**
 * Why a shop can't deliver its order (#69): `perishable_too_slow` when the order has
 * perishable items and no courier delivers it by the end of tomorrow.
 */
export type DeliveryUnavailable = { code: "perishable_too_slow"; reason: string }

/**
 * In-store pickup as checkout offers it for a shop with a collection point (#12): where, how,
 * and when (the shop's own hours), always free, with what happens if it isn't collected.
 */
export type PickupOffer = CollectionPlace & { hold_notice: string }

export type CheckoutSellerGroup = CartSellerGroup & {
  /** How the shop's order reaches the buyer: delivered (preselected where it can be), or collected in store. */
  method: FulfilmentMethod
  /** The shop's chosen delivery, once quoted; null before, when the cart changed since, or for pickup. */
  shipping: CheckoutShipping | null
  /** Best value (preselected), the cheapest and the fastest, as quoted for the current cart. */
  delivery_choices: CheckoutDeliveryChoice[]
  /** Set when the shop can't deliver the order as it stands; checkout can't be paid until it changes, or it is collected. */
  delivery_unavailable: DeliveryUnavailable | null
  /** Pickup, offered when the shop has a collection point; null when it doesn't. */
  pickup: PickupOffer | null
  /** Why checkout switched the shop to pickup itself: no courier brings its fresh items in time. */
  pickup_note: string | null
}

/** Who the buyer is when nothing is delivered: a name and a phone, for the shop to hand the order to. */
export type CheckoutContact = { first_name: string; last_name: string; phone: string }

export type Checkout = {
  cart_id: string
  currency_code: string
  email: string | null
  /** Where delivered orders go; null when every shop's order is collected. */
  shipping_address: CheckoutAddress | null
  /** The buyer's name and phone, from the delivery address or, when every order is collected, given on their own. */
  contact: CheckoutContact | null
  sellers: CheckoutSellerGroup[]
  item_subtotal: number
  shipping_total: number
  /** What the buyer pays: prices are VAT-inclusive, so items plus delivery. */
  total: number
  /**
   * Every item's shop is taking orders and either delivers to the address or is collected (with
   * the buyer's name and phone given), so payment can start.
   */
  ready_to_pay: boolean
  /** Set once payment is confirmed and the cart has become orders. */
  order_group_id: string | null
}

export type CheckoutPayment = { provider_id: string; reference: string; authorization_url: string }

/** A line whose shop's price changed since it was added or last repriced: what it was, and what it is now. */
export type CheckoutPriceChange = PriceChange & { seller: CartSeller; quantity: number }

/** Setting the address reprices the cart too: the checkout, and the lines whose price changed. */
export type CheckoutPrepared = { checkout: Checkout; price_changes: CheckoutPriceChange[] }

/**
 * Starting a payment reprices the cart first. When a price changed, no payment is started:
 * `payment` is null and `price_changes` says what changed, for the buyer to see before paying.
 */
export type CheckoutPaymentStart = {
  payment: CheckoutPayment | null
  price_changes: CheckoutPriceChange[]
  checkout: Checkout
}

type CartRow = {
  id: string
  customer_id: string | null
  completed_at: string | Date | null
  email: string | null
  currency_code: string
  total: number | string
  shipping_total: number | string
  metadata: Record<string, unknown> | null
  shipping_address: (CheckoutAddress & { id: string }) | null
  billing_address: Partial<CheckoutContact> | null
  shipping_methods?:
    | {
        id: string
        shipping_option_id: string | null
        name: string
        amount: number | string
        data: Record<string, unknown> | null
      }[]
    | null
  payment_collection?: {
    id: string
    payment_sessions?: { provider_id: string; data: Record<string, unknown> | null }[] | null
  } | null
}

const ADDRESS_FIELDS = [
  "first_name",
  "last_name",
  "address_1",
  "address_2",
  "city",
  "province",
  "postal_code",
  "country_code",
  "phone",
  "metadata",
] as const

/** The buyer's cart, or not found: another buyer's cart is none of theirs. */
async function buyersCart(scope: MedusaContainer, cartId: string, customerId: string): Promise<CartRow> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "customer_id",
      "completed_at",
      "email",
      "currency_code",
      "total",
      "shipping_total",
      "metadata",
      ...ADDRESS_FIELDS.map((f) => `shipping_address.${f}`),
      "billing_address.first_name",
      "billing_address.last_name",
      "billing_address.phone",
      "shipping_methods.id",
      "shipping_methods.shipping_option_id",
      "shipping_methods.name",
      "shipping_methods.amount",
      "shipping_methods.data",
      "payment_collection.id",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.data",
    ],
    filters: { id: cartId },
  })
  const cart = data[0] as unknown as CartRow | undefined
  if (cart?.customer_id !== customerId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${cartId} not found`)
  }
  return cart
}

const notCompleted = (cart: CartRow) => {
  if (cart.completed_at) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This cart has already been checked out")
}

/** Which shop sells through each shipping option. */
async function sellerOfOptions(scope: MedusaContainer, optionIds: string[]): Promise<Map<string, string>> {
  if (!optionIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "shipping_option", fields: ["id", "seller.id"], filters: { id: optionIds } })
  return new Map((data as { id: string; seller?: { id: string } | null }[]).flatMap((o) => (o.seller ? [[o.id, o.seller.id]] : [])))
}

const isMethodData = (data: unknown): data is ShipbubbleMethodData =>
  !!data && typeof data === "object" && "quote" in data && "choices" in data && "basis" in data

/**
 * Shops that can't deliver, by seller, kept in the cart's metadata under this key with the
 * `quoteBasis` they were quoted for: a shop has no shipping method to say so on.
 */
const UNAVAILABLE_KEY = "delivery_unavailable"
/** A shop's refusal as the cart keeps it: with the `quoteBasis` it was quoted for. */
type QuotedUnavailable = DeliveryUnavailable & { basis: string }
type UnavailableDeliveries = Record<string, QuotedUnavailable>

const unavailableDeliveries = (cart: Pick<CartRow, "metadata">): UnavailableDeliveries => {
  const stored = cart.metadata?.[UNAVAILABLE_KEY]
  if (!stored || typeof stored !== "object") return {}
  // Only entries in the shape checkout writes; anything else counts as no refusal.
  return Object.fromEntries(
    Object.entries(stored).filter(
      (entry): entry is [string, QuotedUnavailable] =>
        !!entry[1] &&
        typeof entry[1] === "object" &&
        (entry[1] as QuotedUnavailable).code === "perishable_too_slow" &&
        typeof (entry[1] as QuotedUnavailable).reason === "string" &&
        typeof (entry[1] as QuotedUnavailable).basis === "string"
    )
  )
}

/** Why a shop can't deliver an order with perishable items, for the buyer. */
const perishableTooSlow = (shopName: string): DeliveryUnavailable => ({
  code: "perishable_too_slow",
  reason: `Fresh and chilled items have to arrive by the end of tomorrow, and no courier can bring ${shopName}'s order to this address in time. Remove the fresh items from ${shopName} to have the rest delivered.`,
})

/**
 * Takes off the cart the delivery of each shop it no longer holds an item from: the buyer
 * removed the shop's last item (say, one whose offer is gone) after its delivery was added.
 */
async function dropEmptyShopDeliveries(scope: MedusaContainer, cart: CartRow) {
  const methods = cart.shipping_methods ?? []
  if (!methods.length) return
  const [{ sellers }, sellerByOption] = await Promise.all([
    retrieveCartBySeller(scope, cart.id),
    sellerOfOptions(scope, methods.flatMap((m) => (m.shipping_option_id ? [m.shipping_option_id] : []))),
  ])
  const sellerIds = new Set(sellers.flatMap((g) => (g.seller ? [g.seller.id] : [])))
  const orphaned = methods.filter((m) => {
    const seller = m.shipping_option_id ? sellerByOption.get(m.shipping_option_id) : undefined
    return !seller || !sellerIds.has(seller)
  })
  if (!orphaned.length) return
  await removeCartDeliveriesWorkflow(scope).run({
    input: { cart_id: cart.id, shipping_method_ids: orphaned.map((m) => m.id) },
  })
}

/** Each shop's Shipbubble delivery on the cart, by seller. */
async function deliveriesBySeller(scope: MedusaContainer, cart: CartRow) {
  const methods = (cart.shipping_methods ?? []).filter((m) => m.shipping_option_id && isMethodData(m.data))
  const sellerByOption = await sellerOfOptions(scope, methods.map((m) => m.shipping_option_id!))
  return new Map(
    methods.map((m) => [
      sellerByOption.get(m.shipping_option_id!),
      { id: m.id, shipping_option_id: m.shipping_option_id!, amount: Number(m.amount), data: m.data as ShipbubbleMethodData },
    ])
  )
}

/** What a shop's parcel holds, for `quoteBasis`. */
const parcelLines = (group: CartSellerGroup) =>
  group.items.map((i) => ({
    variant_id: i.variant_id ?? "",
    // "Adire Kaftan M"; a single variant is titled like its product.
    title: [i.product_title, i.variant_title !== i.product_title ? i.variant_title : null].filter(Boolean).join(" "),
    quantity: i.quantity,
    unit_price: i.unit_price,
  }))

/** A shop's delivery as checkout shows it: the chosen rate, and the choices it was picked from. */
function shopDelivery(
  delivery: { shipping_option_id: string; amount: number; data: ShipbubbleMethodData } | undefined
): Pick<CheckoutSellerGroup, "shipping" | "delivery_choices"> {
  if (!delivery) return { shipping: null, delivery_choices: [] }
  const { quote, choices } = delivery.data
  return {
    shipping: {
      shipping_option_id: delivery.shipping_option_id,
      name: quote.courier_name,
      amount: delivery.amount,
      choice_id: quote.id,
      delivery_eta_time: quote.delivery_eta_time,
    },
    delivery_choices: choices.map(({ id, courier_name, amount, delivery_eta, delivery_eta_time, tags }) => ({
      id,
      courier_name,
      amount,
      delivery_eta,
      delivery_eta_time,
      time_zone: SHIPBUBBLE_TIMEZONE,
      tags,
    })),
  }
}

/** The cart as checkout shows it: shop by shop, with each shop's delivery and the totals. */
export async function retrieveCheckout(scope: MedusaContainer, cartId: string, customerId: string): Promise<Checkout> {
  const cart = await buyersCart(scope, cartId, customerId)
  const grouped = await retrieveCartBySeller(scope, cartId)
  const deliveries = await deliveriesBySeller(scope, cart)
  // The split writes the group before its orders and links; the cart is marked completed
  // once they are all in place.
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: groups } = cart.completed_at
    ? await query.graph({ entity: "order_group", fields: ["id"], filters: { cart_id: cartId } })
    : { data: [] }

  // A cart in a one-country region carries that country as a stub address: no place to deliver to.
  const address = cart.shipping_address?.address_1 ? cart.shipping_address : null
  const receiverCode = addressCodeOf(address)
  const unavailable = unavailableDeliveries(cart)
  const sellerIds = grouped.sellers.flatMap((g) => (g.seller ? [g.seller.id] : []))
  const [timeZone, collecting, places] = await Promise.all([
    regionTimeZone(scope, grouped.region_id),
    collectedShops(scope, cart),
    collectionPlacesOf(scope, sellerIds),
  ])
  const sellers = grouped.sellers.map((group): CheckoutSellerGroup => {
    const sellerId = group.seller?.id
    const place = sellerId ? places.get(sellerId) : undefined
    const pickup = place ? { ...place, hold_notice: PICKUP_HOLD_NOTICE } : null
    const method: FulfilmentMethod = sellerId && collecting.has(sellerId) ? "pickup" : "delivery"
    const delivery = sellerId && method === "delivery" ? deliveries.get(sellerId) : undefined
    // A delivery quoted for another parcel or address no longer stands; checkout quotes it again.
    // So does a shop's word that it can't deliver. An order with perishable items (perhaps only
    // since the quote) takes only a delivery still arriving by the end of tomorrow, and a shop
    // refused one only while it has perishable items.
    const basis = quoteBasis(receiverCode, parcelLines(group))
    const inTime = !!delivery && ratesFor([delivery.data.quote], { perishable: group.perishable, timeZone }).length > 0
    const current = delivery?.data.basis === basis && inTime ? delivery : undefined
    const refused = sellerId ? unavailable[sellerId] : undefined
    const delivery_unavailable =
      group.perishable && refused?.basis === basis ? { code: refused.code, reason: refused.reason } : null
    return {
      ...group,
      method,
      ...shopDelivery(current),
      delivery_unavailable,
      pickup,
      // Checkout switched it to pickup: no courier brings its fresh items in time (#69).
      pickup_note: method === "pickup" && delivery_unavailable ? PERISHABLE_PICKUP_NOTE : null,
    }
  })
  const contact = contactOf(cart.billing_address)
  const allCollected = sellers.length > 0 && sellers.every((g) => g.method === "pickup")
  return {
    cart_id: cart.id,
    currency_code: cart.currency_code,
    email: cart.email ?? null,
    shipping_address: address
      ? (Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, address[f] ?? null])) as CheckoutAddress)
      : null,
    contact,
    sellers,
    // The shops' own prices, VAT included; Medusa's `item_subtotal` excludes the VAT.
    item_subtotal: grouped.item_subtotal,
    shipping_total: Number(cart.shipping_total),
    total: Number(cart.total),
    ready_to_pay:
      (allCollected ? !!contact : !!address) &&
      !!cart.email &&
      sellers.length > 0 &&
      sellers.every((g) => g.seller && (g.method === "pickup" || g.shipping) && g.shop_status?.orderable),
    order_group_id: (groups[0] as { id: string } | undefined)?.id ?? null,
  }
}

const contactOf = (address: Partial<CheckoutContact> | null): CheckoutContact | null =>
  address?.first_name && address.last_name && address.phone
    ? { first_name: address.first_name, last_name: address.last_name, phone: address.phone }
    : null

/** The shops whose orders the buyer collects: those with their pickup as the cart's shipping method. */
async function collectedShops(scope: MedusaContainer, cart: CartRow): Promise<Set<string>> {
  const methods = (cart.shipping_methods ?? []).filter((m) => m.shipping_option_id && isPickupMethod(m))
  const sellerByOption = await sellerOfOptions(scope, methods.map((m) => m.shipping_option_id!))
  return new Set(methods.flatMap((m) => sellerByOption.get(m.shipping_option_id!) ?? []))
}

const linePrice = ({ unit_price, compare_at_unit_price, is_tax_inclusive }: LinePrice): LinePrice => ({
  unit_price,
  compare_at_unit_price,
  is_tax_inclusive,
})

const samePrice = (a: LinePrice, b: LinePrice) =>
  a.unit_price === b.unit_price &&
  a.compare_at_unit_price === b.compare_at_unit_price &&
  a.is_tax_inclusive === b.is_tax_inclusive

/**
 * Lines are pinned to the price their offer had when added (`cart-lines.ts`); before the buyer
 * pays, each is brought to its offer's current price: unit price, compare-at price and tax
 * inclusivity, priced per offer, so two shops' offers of one variant keep their own prices.
 * Returns the lines whose price changed. A line whose shop stopped selling it has to be
 * removed first.
 */
async function repriceLines(scope: MedusaContainer, cartId: string): Promise<CheckoutPriceChange[]> {
  const { sellers } = await retrieveCartBySeller(scope, cartId)
  if (sellers.some((g) => !g.seller)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Some items are no longer sold by their shop. Remove them to check out."
    )
  }
  const lines = sellers.flatMap((g) => g.items.map((item) => ({ item, seller: g.seller! })))
  const prices = await Promise.all(lines.map(({ item }) => offerLinePrice(scope, cartId, item.offer_id!)))
  const changes = lines.flatMap(({ item, seller }, i): CheckoutPriceChange[] => {
    const was = linePrice(item)
    const now = linePrice(prices[i])
    if (samePrice(was, now)) return []
    const { id, product_title, variant_title, quantity } = item
    return [{ line_item_id: id, seller, product_title, variant_title, quantity, was, now }]
  })
  const cartModule = scope.resolve(Modules.CART)
  // One line at a time: each update is a workflow on the same cart.
  for (const { line_item_id, quantity, was, now } of changes) {
    // Medusa's line update keeps a tax-inclusive line inclusive, so a currency that stopped
    // including VAT is set on the line first; the update then totals the cart with it.
    if (was.is_tax_inclusive !== now.is_tax_inclusive) {
      await cartModule.updateLineItems(line_item_id, { is_tax_inclusive: now.is_tax_inclusive })
    }
    await updateLineItemInCartWorkflow(scope).run({
      input: {
        cart_id: cartId,
        item_id: line_item_id,
        update: {
          quantity,
          unit_price: now.unit_price,
          compare_at_unit_price: now.compare_at_unit_price,
        } as never,
      },
    })
  }
  return changes
}

/** Each shop's Shipbubble shipping option, by seller. */
async function shipbubbleOptionsBySeller(scope: MedusaContainer, sellerIds: string[]): Promise<Map<string, string>> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "seller.id"],
    filters: { provider_id: SHIPBUBBLE_PROVIDER_ID },
  })
  const wanted = new Set(sellerIds)
  return new Map(
    (data as { id: string; seller?: { id: string } | null }[]).flatMap((o) =>
      o.seller && wanted.has(o.seller.id) ? [[o.seller.id, o.id] as const] : []
    )
  )
}

type ShopQuote =
  | { sellerId: string; option: { id: string; data: ShipbubbleMethodData } }
  /** `collect`: the shop has a collection point, so its order is collected instead. */
  | { sellerId: string; unavailable: QuotedUnavailable; collect: boolean }

/**
 * Each shop's way to the buyer (#12, #23): the shops the buyer collects from get their pickup;
 * the rest are delivered to the cart's address at Shipbubble's rates for the shop's parcel, with
 * best value chosen. A shop no courier will deliver for refuses the checkout. An order with
 * perishable items goes only by rates arriving by the end of tomorrow (#69); with none, that
 * shop's delivery is unavailable, which the cart keeps so checkout can say why, and its order is
 * collected instead when the shop has a collection point.
 */
async function setShopMethods(
  scope: MedusaContainer,
  cart: CartRow,
  { receiverCode, pickup }: { receiverCode: number | null; pickup: Set<string> }
) {
  const { sellers, currency_code, region_id } = await retrieveCartBySeller(scope, cart.id)
  const ids = sellers.map((g) => g.seller!.id)
  const [optionBySeller, pickupOptions, timeZone, points] = await Promise.all([
    shipbubbleOptionsBySeller(scope, ids),
    pickupOptionsBySeller(scope, ids),
    regionTimeZone(scope, region_id),
    collectionPointsOf(scope, ids),
  ])
  const pickupOption = (sellerId: string) => {
    const id = pickupOptions.get(sellerId)
    if (!id) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Shop ${sellerId} has a collection point but no pickup option`)
    return id
  }
  const delivered = sellers.filter((g) => !pickup.has(g.seller!.id))
  // Each shop is quoted from its own pickup address, so the quotes are asked for at once.
  const quotes: ShopQuote[] = await Promise.all(
    delivered.map(async (group): Promise<ShopQuote> => {
      const seller = group.seller!
      const optionId = optionBySeller.get(seller.id)
      const lines = parcelLines(group)
      const basis = quoteBasis(receiverCode, lines)
      const rates =
        optionId && receiverCode != null
          ? await quoteRates(scope, { sellerId: seller.id, receiverCode, lines, currencyCode: currency_code })
          : []
      if (!optionId || !rates.length) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `${seller.name} doesn't deliver to this address`)
      }
      const choices = deliveryChoices(ratesFor(rates, { perishable: group.perishable, timeZone }))
      if (!choices.length) {
        return { sellerId: seller.id, unavailable: { ...perishableTooSlow(seller.name), basis }, collect: points.has(seller.id) }
      }
      // `deliveryChoices` puts best value first.
      return { sellerId: seller.id, option: { id: optionId, data: { quote: choices[0]!, choices, basis } } }
    })
  )

  const collected = [...pickup, ...quotes.flatMap((q) => ("collect" in q && q.collect ? [q.sellerId] : []))]
  const options = [
    ...quotes.flatMap((q) => ("option" in q ? [q.option] : [])),
    ...collected.map((sellerId) => ({ id: pickupOption(sellerId), data: { ...PICKUP_METHOD_DATA } })),
  ]
  const unavailable = Object.fromEntries(quotes.flatMap((q) => ("unavailable" in q ? [[q.sellerId, q.unavailable]] : [])))
  // A shop that can't deliver keeps no delivery quoted for an earlier cart, which would still be
  // charged; one collected instead has it replaced by its pickup.
  const deliveries = await deliveriesBySeller(scope, cart)
  const stale = quotes.flatMap((q) => {
    const method = "unavailable" in q && !q.collect ? deliveries.get(q.sellerId) : undefined
    return method ? [method.id] : []
  })
  const carts = scope.resolve(Modules.CART)
  if (stale.length) await carts.softDeleteShippingMethods(stale)
  if (options.length) await addSellerShippingMethodToCartWorkflow(scope).run({ input: { cart_id: cart.id, options } })
  const { data } = await scope
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "cart", fields: ["id", "metadata"], filters: { id: cart.id } })
  const metadata = (data[0] as Pick<CartRow, "metadata"> | undefined)?.metadata ?? {}
  await carts.updateCarts(cart.id, { metadata: { ...metadata, [UNAVAILABLE_KEY]: unavailable } })
}

/**
 * The shops the buyer collects from, each in the cart and offering pickup (a collection point);
 * refused (400) otherwise.
 */
async function pickupShops(scope: MedusaContainer, sellers: CartSellerGroup[], sellerIds: string[]): Promise<Set<string>> {
  const points = await collectionPointsOf(scope, sellerIds)
  for (const id of sellerIds) {
    const group = sellers.find((g) => g.seller?.id === id)
    if (!group) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Pickup was chosen for a shop that isn't in the cart")
    if (!points.has(id)) throw new MedusaError(MedusaError.Types.INVALID_DATA, `${group.seller!.name} doesn't offer pickup`)
  }
  return new Set(sellerIds)
}

/** What the buyer sends to ready the cart to pay. */
export type CheckoutPreparation = {
  /** Where delivered orders go; not needed when every shop's order is collected. */
  shippingAddress?: CheckoutAddress | null
  /** The buyer's name and phone, when there is no delivery address to take them from. */
  contact?: CheckoutContact | null
  /** The shops whose orders the buyer collects in store (#12); the rest are delivered. */
  pickup?: string[]
}

/**
 * Readies the buyer's cart to pay: every line at its shop's current price, the buyer's email,
 * and each shop's way to the buyer. Shops the buyer collects from get their pickup; the rest are
 * delivered to the address, validated with Shipbubble, each quoted with best value chosen. A
 * checkout where every shop is collected takes no address and asks Shipbubble nothing, only the
 * buyer's name and phone. Safe to repeat, e.g. after editing the address, the choices or the
 * cart. Returns the checkout and the lines whose price changed, for the buyer to see.
 */
export async function prepareCheckout(
  scope: MedusaContainer,
  { cartId, customerId, shippingAddress, contact, pickup = [] }: { cartId: string; customerId: string } & CheckoutPreparation
): Promise<CheckoutPrepared> {
  const cart = await buyersCart(scope, cartId, customerId)
  notCompleted(cart)
  const customer = await scope.resolve(Modules.CUSTOMER).retrieveCustomer(customerId)

  const priceChanges = await repriceLines(scope, cartId)
  await dropEmptyShopDeliveries(scope, cart)
  const { sellers } = await retrieveCartBySeller(scope, cartId)
  const collecting = await pickupShops(scope, sellers, pickup)
  const allCollected = sellers.every((g) => collecting.has(g.seller!.id))

  if (allCollected) {
    const buyer = contact ?? (shippingAddress && contactOf(shippingAddress))
    if (!buyer) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Give your name and phone number for the shop")
    await updateCartWorkflow(scope).run({ input: { id: cartId, email: customer.email, billing_address: buyer as CreateAddressDTO } })
    // Nothing is delivered, so no address is kept.
    if (cart.shipping_address) await scope.resolve(Modules.CART).updateCarts(cartId, { shipping_address_id: null })
    await setShopMethods(scope, await buyersCart(scope, cartId, customerId), { receiverCode: null, pickup: collecting })
    return { checkout: await retrieveCheckout(scope, cartId, customerId), price_changes: priceChanges }
  }

  if (!shippingAddress) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Set the delivery address")
  // Validated unless it is the cart's own address sent again, which keeps its code (ADR 0002).
  // A code is never taken from the request: it sets what delivery costs and where it goes.
  const previous = cart.shipping_address
  const knownCode = previous && samePlace(previous, shippingAddress) ? addressCodeOf(previous) : null
  const { shipbubble_address_code: _sent, ...metadata } = shippingAddress.metadata ?? {}
  const address = await withAddressCode(
    { ...shippingAddress, metadata: knownCode == null ? metadata : { ...metadata, shipbubble_address_code: knownCode } },
    { name: `${shippingAddress.first_name} ${shippingAddress.last_name}`, email: customer.email }
  )
  await updateCartWorkflow(scope).run({
    input: {
      id: cartId,
      email: customer.email,
      shipping_address: address as CreateAddressDTO,
      billing_address: address as CreateAddressDTO,
    },
  })
  await setShopMethods(scope, await buyersCart(scope, cartId, customerId), {
    receiverCode: addressCodeOf(address)!,
    pickup: collecting,
  })
  return { checkout: await retrieveCheckout(scope, cartId, customerId), price_changes: priceChanges }
}

/**
 * Changes a shop's delivery to another of the choices it was quoted (best value, the cheapest
 * or the fastest). Choices quoted for an earlier cart are gone: checkout quotes them again.
 */
export async function chooseDelivery(
  scope: MedusaContainer,
  { cartId, customerId, sellerId, choiceId }: { cartId: string; customerId: string; sellerId: string; choiceId: string }
): Promise<Checkout> {
  const cart = await buyersCart(scope, cartId, customerId)
  notCompleted(cart)
  const delivery = (await deliveriesBySeller(scope, cart)).get(sellerId)
  const choice = delivery?.data.choices.find((c) => c.id === choiceId)
  if (!delivery || !choice) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "That delivery isn't one of the shop's choices. Check the address again.")
  }
  await addSellerShippingMethodToCartWorkflow(scope).run({
    input: { cart_id: cartId, options: [{ id: delivery.shipping_option_id, data: { ...delivery.data, quote: choice } }] },
  })
  return retrieveCheckout(scope, cartId, customerId)
}

/** The cart's current Paystack transaction is paid; its order is on the way (409). */
export class CheckoutAlreadyPaidError extends Error {
  constructor() {
    super("This cart is already paid. Its order appears as soon as Paystack confirms the payment.")
  }
}

/**
 * A buyer who paid but closed Paystack's page before it sent them back would otherwise start,
 * and could pay, a second transaction while the first one's webhook is on its way. Paystack's
 * word on the cart's current transaction decides: once paid, the buyer waits for the order.
 */
async function refuseIfAlreadyPaid(cart: CartRow) {
  const reference = cart.payment_collection?.payment_sessions?.find((s) => s.provider_id === PAYSTACK_PROVIDER_ID)
    ?.data?.reference
  const paystack = paystackClient()
  if (typeof reference !== "string" || !paystack) return
  const transaction = await paystack.verify(reference)
  if (transaction.status === "success") throw new CheckoutAlreadyPaidError()
}

/**
 * Starts a Paystack transaction for the prepared cart's total and returns where to pay it.
 * Each call starts a new one, so a buyer whose payment failed or was abandoned pays again here.
 * The cart is repriced first; when a price changed, no transaction is started and the buyer
 * is told what changed, then pays the new total by calling again.
 * `returnUrl` is where Paystack sends the buyer afterwards: the app's deep link.
 */
export async function startCheckoutPayment(
  scope: MedusaContainer,
  { cartId, customerId, returnUrl }: { cartId: string; customerId: string; returnUrl: string }
): Promise<CheckoutPaymentStart> {
  const cart = await buyersCart(scope, cartId, customerId)
  notCompleted(cart)
  await refuseIfAlreadyPaid(cart)
  // The cart may have changed since its address was set, and shops change prices.
  const priceChanges = await repriceLines(scope, cartId)
  await dropEmptyShopDeliveries(scope, cart)
  const checkout = await retrieveCheckout(scope, cartId, customerId)
  // A shop in a closed exception or paused takes no orders until it reopens (ADR 0004).
  const closed = checkout.sellers.find((g) => g.seller && g.shop_status && !g.shop_status.orderable)
  if (closed) throw closedShopError(closed.seller!.name, closed.shop_status!)
  // A shop collected instead of delivered doesn't need a courier.
  const undeliverable = checkout.sellers.find((g) => g.delivery_unavailable && g.method === "delivery")
  if (undeliverable) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, undeliverable.delivery_unavailable!.reason)
  if (!checkout.ready_to_pay) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Choose how each shop's order reaches you before paying")
  }
  if (priceChanges.length) return { payment: null, price_changes: priceChanges, checkout }

  let paymentCollectionId = cart.payment_collection?.id
  if (!paymentCollectionId) {
    const { result } = await createPaymentCollectionForCartWorkflow(scope).run({ input: { cart_id: cartId } })
    paymentCollectionId = result.id
  }
  // Replaces any earlier session, so only the newest transaction can complete the cart.
  const { result: session } = await createPaymentSessionsWorkflow(scope).run({
    input: {
      payment_collection_id: paymentCollectionId,
      provider_id: PAYSTACK_PROVIDER_ID,
      customer_id: customerId,
      data: { email: checkout.email!, callback_url: returnUrl },
    },
  })
  const data = session.data as unknown as PaystackSessionData
  return {
    payment: { provider_id: PAYSTACK_PROVIDER_ID, reference: data.reference, authorization_url: data.authorization_url },
    price_changes: [],
    checkout,
  }
}
