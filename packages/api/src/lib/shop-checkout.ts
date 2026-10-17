import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createCartWorkflow, deleteLineItemsWorkflow, deletePaymentSessionsWorkflow } from "@medusajs/medusa/core-flows"
import { applyShopPromotionsWorkflow } from "../workflows/checkout/apply-shop-promotions"
import { retrieveCartBySeller, type CartBySeller } from "./cart"
import { addOffersToCart } from "./cart-lines"
import { buyersCart, dropEmptyShopDeliveries, notCompleted, refuseIfAlreadyPaid } from "./checkout"

// "Pay for this shop only" (#11): the cart stays shared across shops, and a buyer can pay for
// one shop's items on their own. Those items move to a cart of their own, which goes through
// the same checkout as any cart and becomes an order group with a single order. The original
// cart keeps the other shops' items, so the app's cart, its count and the sign-in merge are
// unchanged.

type CartBasics = { id: string; region_id: string; sales_channel_id: string | null; currency_code: string }

async function cartBasics(scope: MedusaContainer, cartId: string): Promise<CartBasics> {
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "cart",
    fields: ["id", "region_id", "sales_channel_id", "currency_code"],
    filters: { id: cartId },
  })
  return data[0] as unknown as CartBasics
}

/**
 * Moves one shop's items out of the buyer's cart into a new cart of theirs, and returns it by
 * shop. The items go in through add-to-cart, so each is pinned to its offer at the offer's
 * current price, as any added item is. A shop not in the cart, or a cart holding only that
 * shop, is refused: the cart is already checked out as it is.
 */
export async function moveShopToOwnCart(
  scope: MedusaContainer,
  { cartId, customerId, sellerId }: { cartId: string; customerId: string; sellerId: string }
): Promise<CartBySeller> {
  const cart = await buyersCart(scope, cartId, customerId)
  notCompleted(cart)
  const { sellers } = await retrieveCartBySeller(scope, cartId)
  const group = sellers.find((g) => g.seller?.id === sellerId)
  if (!group) throw new MedusaError(MedusaError.Types.INVALID_DATA, "That shop has nothing in your cart")
  if (sellers.length === 1) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Your cart only has ${group.seller!.name}'s items: check it out as it is`)
  }

  // The buyer paid for the whole cart: its order is on the way, with these items in it.
  await refuseIfAlreadyPaid(cart)
  // A Paystack page already opened for the whole cart must not place an order for items that
  // moved: without its session, a payment on it is refunded in full (ADR 0003), like a replaced page.
  const sessions = cart.payment_collection?.payment_sessions ?? []
  if (sessions.length) {
    await deletePaymentSessionsWorkflow(scope).run({ input: { ids: sessions.map((s) => s.id) } })
  }

  const basics = await cartBasics(scope, cartId)
  const { result: shopCart } = await createCartWorkflow(scope).run({
    input: {
      region_id: basics.region_id,
      sales_channel_id: basics.sales_channel_id ?? undefined,
      currency_code: basics.currency_code,
      customer_id: customerId,
      email: cart.email ?? undefined,
    },
  })
  await addOffersToCart(
    scope,
    shopCart.id,
    group.items.map((item) => ({ offer_id: item.offer_id!, quantity: item.quantity }))
  )
  await deleteLineItemsWorkflow(scope).run({ input: { cart_id: cartId, ids: group.items.map((i) => i.id) } })
  // The shop's delivery leaves with its items.
  await dropEmptyShopDeliveries(scope, cart)
  await applyShopPromotionsWorkflow(scope).run({ input: { cart_id: cartId } })

  return retrieveCartBySeller(scope, shopCart.id)
}
