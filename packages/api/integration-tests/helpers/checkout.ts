import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SEED_PASSWORD, SEED_PRODUCTS, SEED_SELLERS } from "../../src/scripts/seed-data"
import { vendorHeaders } from "./auth"
import type { fakeClerk } from "./clerk"
import type { fakePaystack } from "./paystack"
import { BEST_VALUE_FEE } from "./shipbubble"

type Api = {
  get: (url: string, config?: unknown) => Promise<{ data: any; status: number }>
  post: (url: string, body?: unknown, config?: unknown) => Promise<{ data: any; status: number }>
}

export type Shop = (typeof SEED_SELLERS)[number]

export const LANTERN = SEED_PRODUCTS.find((p) => p.title === "Rechargeable LED Lantern")!
export const RICE = SEED_PRODUCTS.find((p) => p.title === "Ofada Rice 5kg")!
export const [GROCERY, , GADGETS] = SEED_SELLERS
/** Ada's cart: a lantern from the gadget hub, two bags of rice from the grocery shop, each delivered at its best-value rate. */
export const TOTAL = LANTERN.price + 2 * RICE.price + 2 * BEST_VALUE_FEE
/** What each shop's order of Ada's cart comes to. */
export const ORDER_TOTALS = new Map<Shop, number>([
  [GADGETS, LANTERN.price + BEST_VALUE_FEE],
  [GROCERY, 2 * RICE.price + BEST_VALUE_FEE],
])

export const RETURN_URL = "https://api.oja.test/paystack/return"
export const ADDRESS = {
  first_name: "Ada",
  last_name: "Obi",
  address_1: "3 Akin Adesola Street",
  address_2: "Flat 4",
  city: "Eti-Osa",
  province: "Lagos",
  country_code: "ng",
  phone: "+2348031234567",
  metadata: { landmark: "Opposite the Mobil station" },
}

/** Polls `read` until `done` holds of what it returns, then returns that; throws after ~`tries` tenths of a second. */
export async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, tries = 100): Promise<T> {
  let value = await read()
  for (let attempt = 0; attempt < tries && !done(value); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    value = await read()
  }
  if (!done(value)) throw new Error(`still not done after ${tries} tries: ${JSON.stringify(value)}`)
  return value
}

/**
 * A buyer (Ada) checking out the seeded shops with Paystack, and the shops seeing her orders.
 * Call `load` in a `beforeEach`, once the app has been seeded.
 */
export function buyerCheckout({
  api,
  getContainer,
  clerk,
  paystack,
}: {
  api: Api
  getContainer: () => MedusaContainer
  clerk: ReturnType<typeof fakeClerk>
  paystack: ReturnType<typeof fakePaystack>
}) {
  let headers: Record<string, string> = {}
  let regionId = ""

  const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)

  const load = async () => {
    const { data: keys } = await query().graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } })
    headers = { "x-publishable-api-key": keys[0].token }
    const { data: regions } = await query().graph({ entity: "region", fields: ["id"] })
    regionId = regions[0].id
  }

  const as = (email: string) => {
    const token = clerk.sessionToken({ sub: `user_${email}`, email })
    return { headers: { ...headers, authorization: `Bearer ${token}` } }
  }
  const ada = () => as("ada@oja.test")

  const sellerId = async (shop: Shop) => {
    const { data } = await query().graph({ entity: "seller", fields: ["id"], filters: { name: shop.name } })
    return data[0].id as string
  }
  const offerId = async (shop: Shop, title: string) => {
    const { data: products } = await query().graph({ entity: "product", fields: ["id"], filters: { title } })
    const { data } = await query().graph({
      entity: "offer",
      fields: ["id"],
      filters: { seller_id: await sellerId(shop), product_id: products[0].id },
    })
    return data[0].id as string
  }
  const owner = async (shop: Shop) => vendorHeaders(api, shop.owner.email, SEED_PASSWORD, await sellerId(shop))

  const adasCart = async () => {
    const { data } = await api.post("/store/carts", { region_id: regionId }, ada())
    const cartId = data.cart.id as string
    await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GADGETS, LANTERN.title), quantity: 1 }, ada())
    await api.post(`/store/carts/${cartId}/line-items`, { offer_id: await offerId(GROCERY, RICE.title), quantity: 2 }, ada())
    return cartId
  }

  const prepare = (cartId: string) => api.post(`/store/carts/${cartId}/checkout`, { shipping_address: ADDRESS }, ada())
  const startPayment = async (cartId: string) =>
    (await api.post(`/store/carts/${cartId}/checkout/payment`, { return_url: RETURN_URL }, ada())).data.payment
  const checkout = async (cartId: string) => (await api.get(`/store/carts/${cartId}/checkout`, ada())).data.checkout
  const postWebhook = ({ body, headers }: { body: string; headers: Record<string, string> }) =>
    api.post("/hooks/payment/paystack_paystack", body, { headers })

  /** The cart's order group once the webhook's subscriber has completed it. */
  const orderGroupOf = async (cartId: string) =>
    (await eventually(() => checkout(cartId), (c) => !!c.order_group_id)).order_group_id as string
  const paymentOf = async (cartId: string) => {
    const { data } = await query().graph({
      entity: "cart",
      fields: ["payment_collection.payments.id", "payment_collection.payments.captured_at", "payment_collection.payments.captures.amount"],
      filters: { id: cartId },
    })
    return (data[0].payment_collection?.payments?.[0] ?? null) as any
  }
  const capturedWithin = async (cartId: string) => {
    try {
      return await eventually(() => paymentOf(cartId), (p) => !!p?.captured_at)
    } catch {
      return paymentOf(cartId)
    }
  }
  const ordersOfCart = async (cartId: string) => {
    const { data } = await query().graph({ entity: "order_cart", fields: ["order_id"], filters: { cart_id: cartId } })
    return data as { order_id: string }[]
  }

  /** Ada pays for her cart, Paystack confirms it, and it is split into an order per shop. Returns the cart and Paystack reference. */
  const paidCheckout = async () => {
    const cartId = await adasCart()
    await prepare(cartId)
    const { reference } = await startPayment(cartId)
    paystack.pay(reference)
    await postWebhook(paystack.chargeSuccess(reference))
    await orderGroupOf(cartId)
    await capturedWithin(cartId)
    return { cartId, reference: reference as string }
  }

  /** The shop's order of a cart. */
  const shopOrderId = async (shop: Shop, cartId: string) => {
    const orderIds = (await ordersOfCart(cartId)).map((c) => c.order_id)
    const { data } = await query().graph({
      entity: "order_seller",
      fields: ["order_id"],
      filters: { seller_id: await sellerId(shop), order_id: orderIds },
    })
    return data[0].order_id as string
  }

  return {
    load,
    query,
    headers: () => headers,
    regionId: () => regionId,
    as,
    ada,
    sellerId,
    offerId,
    owner,
    adasCart,
    prepare,
    startPayment,
    checkout,
    postWebhook,
    orderGroupOf,
    paymentOf,
    capturedWithin,
    ordersOfCart,
    paidCheckout,
    shopOrderId,
  }
}
