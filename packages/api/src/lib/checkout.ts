import type { CreateAddressDTO, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  updateCartWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  addSellerShippingMethodToCartWorkflow,
  listSellerShippingOptionsForCartWorkflow,
} from "@mercurjs/core/workflows"
import { PAYSTACK_PROVIDER_ID } from "../modules/paystack"
import type { PaystackSessionData } from "../modules/paystack/service"
import { retrieveCartBySeller, type CartSellerGroup } from "./cart"
import { offerLinePrice } from "./cart-lines"

// Checkout of a multi-shop cart (#16): the buyer's address, one flat delivery per shop, then
// a Paystack payment for the lot. Paystack's webhook completes the cart into an order group
// with one order per shop (docs/adr/0003-paystack-payments.md); the app polls the checkout
// until it has one.

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
  /** `landmark`: directions for the rider (ADR 0002). */
  metadata?: Record<string, unknown> | null
}

export type CheckoutShipping = { shipping_option_id: string; name: string; amount: number }

export type CheckoutSellerGroup = CartSellerGroup & {
  /** The shop's delivery, once an address is set; null before, or when it can't deliver. */
  shipping: CheckoutShipping | null
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
  shipping_methods?: { shipping_option_id: string | null; name: string; amount: number | string }[] | null
  payment_collection?: { id: string } | null
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
      "payment_collection.id",
    ],
    filters: { id: cartId },
  })
  const cart = data[0] as CartRow | undefined
  if (!cart || cart.customer_id !== customerId) {
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

/** The cart as checkout shows it: shop by shop, with each shop's delivery and the totals. */
export async function retrieveCheckout(scope: MedusaContainer, cartId: string, customerId: string): Promise<Checkout> {
  const cart = await buyersCart(scope, cartId, customerId)
  const grouped = await retrieveCartBySeller(scope, cartId)
  const methods = (cart.shipping_methods ?? []).filter((m) => m.shipping_option_id)
  const sellerByOption = await sellerOfOptions(scope, methods.map((m) => m.shipping_option_id!))
  const shippingBySeller = new Map(
    methods.map((m) => [
      sellerByOption.get(m.shipping_option_id!),
      { shipping_option_id: m.shipping_option_id!, name: m.name, amount: Number(m.amount) },
    ])
  )
  // The split writes the group before its orders and links; the cart is marked completed
  // once they are all in place.
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: groups } = cart.completed_at
    ? await query.graph({ entity: "order_group", fields: ["id"], filters: { cart_id: cartId } })
    : { data: [] }

  const address = cart.shipping_address
  return {
    cart_id: cart.id,
    currency_code: cart.currency_code,
    email: cart.email ?? null,
    shipping_address: address
      ? (Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, address[f] ?? null])) as CheckoutAddress)
      : null,
    sellers: grouped.sellers.map((group) => ({
      ...group,
      shipping: (group.seller && shippingBySeller.get(group.seller.id)) || null,
    })),
    // The shops' own prices, VAT included; Medusa's `item_subtotal` excludes the VAT.
    item_subtotal: grouped.item_subtotal,
    shipping_total: Number(cart.shipping_total),
    total: Number(cart.total),
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

/**
 * Each shop's delivery to the cart's address: its flat rate, the cheapest option it offers
 * there, until live Shipbubble quotes let the buyer choose (#23).
 */
async function setShopDeliveries(scope: MedusaContainer, cartId: string) {
  const { sellers } = await retrieveCartBySeller(scope, cartId)
  const { result: optionsBySeller } = await listSellerShippingOptionsForCartWorkflow(scope).run({
    input: { cart_id: cartId, is_return: false },
  })
  const options = (optionsBySeller ?? {}) as Record<string, { id: string; amount?: number | null }[]>
  const chosen = sellers.map(({ seller }) => {
    const cheapest = (options[seller!.id] ?? [])
      .filter((o) => o.amount != null)
      .sort((a, b) => Number(a.amount) - Number(b.amount))[0]
    if (!cheapest) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `${seller!.name} doesn't deliver to this address`)
    }
    return { id: cheapest.id }
  })
  await addSellerShippingMethodToCartWorkflow(scope).run({ input: { cart_id: cartId, options: chosen } })
}

/**
 * Readies the buyer's cart to pay: every line at its shop's current price, the buyer's email
 * and delivery address, and one delivery per shop. Safe to repeat, e.g. after editing the address.
 */
export async function prepareCheckout(
  scope: MedusaContainer,
  { cartId, customerId, shippingAddress }: { cartId: string; customerId: string; shippingAddress: CheckoutAddress }
): Promise<Checkout> {
  notCompleted(await buyersCart(scope, cartId, customerId))
  const customer = await scope.resolve(Modules.CUSTOMER).retrieveCustomer(customerId)

  await repriceLines(scope, cartId)
  const address = shippingAddress as CreateAddressDTO
  await updateCartWorkflow(scope).run({
    input: { id: cartId, email: customer.email, shipping_address: address, billing_address: address },
  })
  await setShopDeliveries(scope, cartId)
  return retrieveCheckout(scope, cartId, customerId)
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
  const checkout = await retrieveCheckout(scope, cartId, customerId)
  if (!checkout.shipping_address || !checkout.email || checkout.sellers.some((g) => !g.seller || !g.shipping)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Set the delivery address before paying")
  }
  if (!checkout.sellers.length) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "The cart is empty")

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
      data: { email: checkout.email, callback_url: returnUrl },
    },
  })
  const data = session.data as unknown as PaystackSessionData
  return { provider_id: PAYSTACK_PROVIDER_ID, reference: data.reference, authorization_url: data.authorization_url }
}
