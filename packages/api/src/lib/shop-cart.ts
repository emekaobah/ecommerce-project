import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { retrieveCartBySeller, type CartSellerGroup } from "./cart"
import { offerCartItems, type OfferCartItems } from "./cart-lines"
import { movableCart, type MovableCart } from "./checkout"

// "Pay for this shop only" (#11): the cart stays shared across shops, and a buyer can pay for
// one shop's items on their own. Those items move to a shop cart, which goes through the same
// checkout as any cart and becomes an order group with a single order. The original cart keeps
// the other shops' items, so the app's cart, its count and the sign-in merge are unchanged.
// Going back from the shop cart's checkout without paying moves its items back.
//
// Each move is one workflow (`workflows/checkout/shop-cart.ts`) under the cart lock Mercur's
// cart completion takes, so a Paystack webhook can't complete a cart halfway through a move, and
// a move that fails part-way is undone (ADR 0003). Here is what each move works out first.

/** The shop cart's metadata names the cart its items came from. */
const SHOP_CART_OF_KEY = "shop_cart_of"

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

const discountingCodes = (groups: CartSellerGroup[]) =>
  new Set(groups.flatMap((g) => g.items.flatMap((i) => i.discounts.map((d) => d.code))))

/**
 * The codes the buyer entered that go with the shop's items (ADR 0010: discounts follow items):
 * each code discounting one of them. A fixed amount off the whole cart that also discounts the
 * rest stays with the rest alone, so it is never taken off twice. Automatic promotions need no
 * carrying: they apply to any cart by themselves.
 */
async function codesFollowing(
  scope: MedusaContainer,
  { entered, moved, rest }: { entered: string[]; moved: CartSellerGroup; rest: CartSellerGroup[] }
): Promise<string[]> {
  const discountingMoved = discountingCodes([moved])
  const discountingRest = discountingCodes(rest)
  const candidates = entered.filter((code) => discountingMoved.has(code))
  const fixedAcross = await fixedAcrossCodes(scope, candidates)
  return candidates.filter((code) => !(fixedAcross.has(code) && discountingRest.has(code)))
}

/** What moving a shop's items to a shop cart does, worked out under the cart's lock. */
export type ShopMove = {
  cart_id: string
  shop_cart: {
    region_id: string
    sales_channel_id?: string
    currency_code: string
    customer_id: string
    email?: string
    metadata: Record<string, unknown>
  }
  /** The shop's items, priced afresh from their offers, as add-to-cart prices any item. */
  items: OfferCartItems
  line_ids: string[]
  /** The shop's delivery on the cart, which leaves with its items. */
  delivery_ids: string[]
  /** A Paystack page already opened for the whole cart must not place an order for items that moved. */
  payment_session_ids: string[]
  /** The codes that follow the shop's items. */
  codes: string[]
}

/**
 * Works out moving one shop's items out of the buyer's cart. A shop not in the cart, or a cart
 * holding only that shop, is refused: the cart is checked out as it is. So is a cart already paid
 * for (`CheckoutAlreadyPaidError`): its order is on the way, with these items in it.
 */
export async function planShopMove(
  scope: MedusaContainer,
  { cartId, customerId, sellerId }: { cartId: string; customerId: string; sellerId: string }
): Promise<ShopMove> {
  const cart = await movableCart(scope, cartId, customerId)
  const { sellers } = await retrieveCartBySeller(scope, cartId)
  const group = sellers.find((g) => g.seller?.id === sellerId)
  if (!group?.seller) throw new MedusaError(MedusaError.Types.INVALID_DATA, "That shop has nothing in your cart")
  if (sellers.length === 1) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Your cart only has ${group.seller.name}'s items: check it out as it is`)
  }
  const rest = sellers.filter((g) => g !== group)
  const [items, codes] = await Promise.all([
    offerCartItems(
      scope,
      cartId,
      group.items.flatMap((item) => (item.offer_id ? [{ offer_id: item.offer_id, quantity: item.quantity }] : []))
    ),
    codesFollowing(scope, { entered: cart.codes, moved: group, rest }),
  ])
  return {
    cart_id: cartId,
    shop_cart: {
      region_id: cart.region_id,
      sales_channel_id: cart.sales_channel_id ?? undefined,
      currency_code: cart.currency_code,
      customer_id: customerId,
      email: cart.email ?? undefined,
      metadata: { [SHOP_CART_OF_KEY]: cartId },
    },
    items,
    line_ids: group.items.map((i) => i.id),
    delivery_ids: cart.deliveries.filter((d) => d.seller_id === sellerId).map((d) => d.id),
    payment_session_ids: cart.payment_session_ids,
    codes,
  }
}

/** What moving a shop cart's items back to the cart they came from does, worked out under both carts' locks. */
export type ShopCartBack = {
  cart_id: string
  shop_cart_id: string
  /** The shop cart's items, priced afresh from their offers in the cart they go back to. */
  items: OfferCartItems
  line_ids: string[]
  delivery_ids: string[]
  /** The shop cart's Paystack page must place no order once its items are back. */
  payment_session_ids: string[]
  /** The cart's codes and the shop cart's together. */
  codes: string[]
}

/**
 * Works out moving a shop cart's items back. A cart that isn't the shop cart's origin is not
 * found, and a shop cart already paid for is refused (`CheckoutAlreadyPaidError`).
 */
export async function planShopCartBack(
  scope: MedusaContainer,
  { cartId, shopCartId, customerId }: { cartId: string; shopCartId: string; customerId: string }
): Promise<ShopCartBack> {
  const shopCart: MovableCart = await movableCart(scope, shopCartId, customerId)
  if (shopCart.metadata?.[SHOP_CART_OF_KEY] !== cartId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Shop cart ${shopCartId} not found`)
  }
  const cart = await movableCart(scope, cartId, customerId)
  const { sellers } = await retrieveCartBySeller(scope, shopCartId)
  const items = sellers.flatMap((g) => g.items)
  return {
    cart_id: cartId,
    shop_cart_id: shopCartId,
    // An item whose offer is gone has nothing to go back as.
    items: await offerCartItems(
      scope,
      cartId,
      items.flatMap((item) => (item.offer_id ? [{ offer_id: item.offer_id, quantity: item.quantity }] : []))
    ),
    line_ids: items.map((i) => i.id),
    delivery_ids: shopCart.deliveries.map((d) => d.id),
    payment_session_ids: shopCart.payment_session_ids,
    codes: [...new Set([...cart.codes, ...shopCart.codes])],
  }
}
