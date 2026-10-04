import type { CreateAddressDTO, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  updateCartWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/medusa/core-flows"
import { addSellerShippingMethodToCartWorkflow } from "@mercurjs/core/workflows"
import type { DeliveryTag } from "@oja/domain"
import { PAYSTACK_PROVIDER_ID, paystackClient } from "../modules/paystack"
import type { PaystackSessionData } from "../modules/paystack/service"
import { SHIPBUBBLE_PROVIDER_ID, type ShipbubbleMethodData } from "../modules/shipbubble"
import { retrieveCartBySeller, type CartSellerGroup } from "./cart"
import { offerLinePrice } from "./cart-lines"
import { addressCodeOf, quoteBasis, quoteDelivery, samePlace, withAddressCode } from "./delivery"

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

export type CheckoutSellerGroup = CartSellerGroup & {
  /** The shop's chosen delivery, once quoted; null before, or when the cart changed since. */
  shipping: CheckoutShipping | null
  /** Best value (preselected), the cheapest and the fastest, as quoted for the current cart. */
  delivery_choices: CheckoutDeliveryChoice[]
}

export type Checkout = {
  cart_id: string
  currency_code: string
  email: string | null
  shipping_address: CheckoutAddress | null
  sellers: CheckoutSellerGroup[]
  item_subtotal: number
  shipping_total: number
  /** What the buyer pays: prices are VAT-inclusive, so items plus delivery. */
  total: number
  /** The address is set and every item's shop delivers there, so payment can start. */
  ready_to_pay: boolean
  /** Set once payment is confirmed and the cart has become orders. */
  order_group_id: string | null
}

export type CheckoutPayment = { provider_id: string; reference: string; authorization_url: string }

type CartRow = {
  id: string
  customer_id: string | null
  completed_at: string | Date | null
  email: string | null
  currency_code: string
  total: number | string
  shipping_total: number | string
  shipping_address: (CheckoutAddress & { id: string }) | null
  shipping_methods?:
    | { shipping_option_id: string | null; name: string; amount: number | string; data: Record<string, unknown> | null }[]
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
      ...ADDRESS_FIELDS.map((f) => `shipping_address.${f}`),
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
  const cart = data[0] as CartRow | undefined
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

/** Each shop's Shipbubble delivery on the cart, by seller. */
async function deliveriesBySeller(scope: MedusaContainer, cart: CartRow) {
  const methods = (cart.shipping_methods ?? []).filter((m) => m.shipping_option_id && isMethodData(m.data))
  const sellerByOption = await sellerOfOptions(scope, methods.map((m) => m.shipping_option_id!))
  return new Map(
    methods.map((m) => [
      sellerByOption.get(m.shipping_option_id!),
      { shipping_option_id: m.shipping_option_id!, amount: Number(m.amount), data: m.data as ShipbubbleMethodData },
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

  const address = cart.shipping_address
  const receiverCode = addressCodeOf(address)
  const sellers = grouped.sellers.map((group) => {
    const delivery = group.seller ? deliveries.get(group.seller.id) : undefined
    // A delivery quoted for another parcel or address no longer stands; checkout quotes it again.
    const current = delivery?.data.basis === quoteBasis(receiverCode, parcelLines(group)) ? delivery : undefined
    return { ...group, ...shopDelivery(current) }
  })
  return {
    cart_id: cart.id,
    currency_code: cart.currency_code,
    email: cart.email ?? null,
    shipping_address: address
      ? (Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, address[f] ?? null])) as CheckoutAddress)
      : null,
    sellers,
    // The shops' own prices, VAT included; Medusa's `item_subtotal` excludes the VAT.
    item_subtotal: grouped.item_subtotal,
    shipping_total: Number(cart.shipping_total),
    total: Number(cart.total),
    ready_to_pay:
      !!address && !!cart.email && sellers.length > 0 && sellers.every((g) => g.seller && g.shipping),
    order_group_id: (groups[0] as { id: string } | undefined)?.id ?? null,
  }
}

/**
 * Lines are pinned to the price their offer had when added (`cart-lines.ts`); before the buyer
 * pays, each is brought to its offer's current price. A line whose shop stopped selling it
 * has to be removed first.
 */
async function repriceLines(scope: MedusaContainer, cartId: string) {
  const { sellers } = await retrieveCartBySeller(scope, cartId)
  if (sellers.some((g) => !g.seller)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Some items are no longer sold by their shop. Remove them to check out."
    )
  }
  for (const item of sellers.flatMap((g) => g.items)) {
    const price = await offerLinePrice(scope, cartId, item.offer_id!)
    if (price.unit_price === item.unit_price && price.compare_at_unit_price === item.compare_at_unit_price) continue
    await updateLineItemInCartWorkflow(scope).run({
      input: {
        cart_id: cartId,
        item_id: item.id,
        update: {
          quantity: item.quantity,
          unit_price: price.unit_price,
          compare_at_unit_price: price.compare_at_unit_price,
        } as never,
      },
    })
  }
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

/**
 * Each shop's delivery to the cart's address: Shipbubble's rates for the shop's parcel, with
 * best value chosen. A shop no courier will deliver for refuses the checkout.
 */
async function setShopDeliveries(scope: MedusaContainer, cartId: string, receiverCode: number) {
  const { sellers, currency_code } = await retrieveCartBySeller(scope, cartId)
  const optionBySeller = await shipbubbleOptionsBySeller(scope, sellers.map((g) => g.seller!.id))
  const options: { id: string; data: ShipbubbleMethodData }[] = []
  for (const group of sellers) {
    const seller = group.seller!
    const optionId = optionBySeller.get(seller.id)
    const lines = parcelLines(group)
    const choices = optionId
      ? await quoteDelivery(scope, { sellerId: seller.id, receiverCode, lines, currencyCode: currency_code })
      : []
    if (!optionId || !choices.length) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `${seller.name} doesn't deliver to this address`)
    }
    // `deliveryChoices` puts best value first.
    options.push({ id: optionId, data: { quote: choices[0]!, choices, basis: quoteBasis(receiverCode, lines) } })
  }
  await addSellerShippingMethodToCartWorkflow(scope).run({ input: { cart_id: cartId, options } })
}

/**
 * Readies the buyer's cart to pay: every line at its shop's current price, the buyer's email
 * and delivery address, validated with Shipbubble, and each shop's delivery quoted with best
 * value chosen. Safe to repeat, e.g. after editing the address or the cart.
 */
export async function prepareCheckout(
  scope: MedusaContainer,
  { cartId, customerId, shippingAddress }: { cartId: string; customerId: string; shippingAddress: CheckoutAddress }
): Promise<Checkout> {
  const cart = await buyersCart(scope, cartId, customerId)
  notCompleted(cart)
  const customer = await scope.resolve(Modules.CUSTOMER).retrieveCustomer(customerId)

  await repriceLines(scope, cartId)
  // Validated only when it has no code yet: an address saved with one, or the cart's own
  // address sent again, keeps it (ADR 0002).
  const previous = cart.shipping_address
  const knownCode =
    addressCodeOf(shippingAddress) ?? (previous && samePlace(previous, shippingAddress) ? addressCodeOf(previous) : null)
  const address = await withAddressCode(
    knownCode == null
      ? shippingAddress
      : { ...shippingAddress, metadata: { ...shippingAddress.metadata, shipbubble_address_code: knownCode } },
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
  await setShopDeliveries(scope, cartId, addressCodeOf(address)!)
  return retrieveCheckout(scope, cartId, customerId)
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
 * `returnUrl` is where Paystack sends the buyer afterwards: the app's deep link.
 */
export async function startCheckoutPayment(
  scope: MedusaContainer,
  { cartId, customerId, returnUrl }: { cartId: string; customerId: string; returnUrl: string }
): Promise<CheckoutPayment> {
  const cart = await buyersCart(scope, cartId, customerId)
  notCompleted(cart)
  await refuseIfAlreadyPaid(cart)
  // The cart may have changed since its address was set, and shops change prices.
  await repriceLines(scope, cartId)
  const checkout = await retrieveCheckout(scope, cartId, customerId)
  if (!checkout.ready_to_pay) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Set the delivery address before paying")
  }

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
  return { provider_id: PAYSTACK_PROVIDER_ID, reference: data.reference, authorization_url: data.authorization_url }
}
