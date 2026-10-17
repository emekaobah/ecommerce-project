import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createCartWorkflow, deleteLineItemsWorkflow, deletePaymentSessionsWorkflow } from "@medusajs/medusa/core-flows"
import { applyShopPromotionsWorkflow } from "../workflows/checkout/apply-shop-promotions"
import { retrieveCartBySeller, type CartBySeller, type CartSellerGroup } from "./cart"
import { addOffersToCart } from "./cart-lines"
import { buyersCart, dropEmptyShopDeliveries, enteredCodes, notCompleted, refuseIfAlreadyPaid } from "./checkout"

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

/** The codes whose promotion takes a fixed amount off the whole cart, spread across its items. */
async function fixedAcrossCodes(scope: MedusaContainer, codes: string[]): Promise<Set<string>> {
  if (!codes.length) return new Set()
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "promotion",
    fields: ["code", "application_method.type", "application_method.allocation"],
    filters: { code: codes },
  })
  type Row = { code: string; application_method?: { type: string; allocation: string | null } | null }
  return new Set(
    (data as unknown as Row[])
      .filter((p) => p.application_method?.type === "fixed" && p.application_method.allocation === "across")
      .map((p) => p.code)
  )
}

/**
 * The codes the buyer entered that go with the shop's items (ADR 0010: discounts follow items):
 * each code discounting one of them. A fixed amount off the whole cart that still discounts the
 * rest stays with the rest alone, so it is never taken off twice. Automatic promotions need no
 * carrying: they apply to any cart by themselves.
 */
async function codesFollowing(
  scope: MedusaContainer,
  { entered, moved, kept }: { entered: string[]; moved: CartSellerGroup; kept: string[] }
): Promise<string[]> {
  const discounting = new Set(moved.items.flatMap((i) => i.discounts.map((d) => d.code)))
  const candidates = entered.filter((code) => discounting.has(code))
  const fixedAcross = await fixedAcrossCodes(scope, candidates)
  return candidates.filter((code) => !(fixedAcross.has(code) && kept.includes(code)))
}

/**
 * Moves one shop's items out of the buyer's cart into a new cart of theirs, and returns it by
 * shop. The items go in through add-to-cart, so each is pinned to its offer at the offer's
 * current price, as any added item is, and the codes that discount them go too. A shop not in
 * the cart, or a cart holding only that shop, is refused: the cart is checked out as it is.
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
  const entered = await enteredCodes(scope, cart)

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
  // The rest keeps the codes that still discount something in it.
  const { result: kept } = await applyShopPromotionsWorkflow(scope).run({ input: { cart_id: cartId } })
  const following = await codesFollowing(scope, { entered, moved: group, kept: kept.codes })
  if (following.length) {
    await applyShopPromotionsWorkflow(scope).run({ input: { cart_id: shopCart.id, promo_codes: following } })
  }

  return retrieveCartBySeller(scope, shopCart.id)
}
