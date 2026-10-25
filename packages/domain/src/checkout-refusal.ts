// Why checkout refused, worded by the app rather than in the refusal's text, whose 400s may be
// written for developers: from what the checkout itself shows (#16, ADR 0004), or from the code
// on the two refusals that change what the buyer does next, a promo code and a shop that
// doesn't deliver to the address (#106).

/** Why a promo code was refused at checkout: the `code` on the API's 400. */
export const PROMO_CODE_REFUSALS = {
  /** No such code, or one not running yet as a draft. */
  notFound: "promo_code_not_found",
  expired: "promo_code_expired",
  notStarted: "promo_code_not_started",
  usedUp: "promo_code_used_up",
  /** A shop's code, with none of that shop's items in the cart; the refusal names the shop (`seller`). */
  otherShop: "promo_code_other_shop",
  /** The operator's code, with nothing in the cart it covers. */
  notApplicable: "promo_code_not_applicable",
} as const

export type PromoCodeRefusal = (typeof PROMO_CODE_REFUSALS)[keyof typeof PROMO_CODE_REFUSALS]

/**
 * A shop no courier will take to the delivery address (400): the refusal names the shop
 * (`seller`) and says whether it offers pickup instead (`offers_pickup`).
 */
export const SHOP_DOESNT_DELIVER = "shop_doesnt_deliver"

/** Every code a coded checkout refusal carries. */
export type CheckoutRefusalCode = PromoCodeRefusal | typeof SHOP_DOESNT_DELIVER

/**
 * The fields a coded refusal adds to the API's `{ code, type, message }`: the shop it names,
 * and for `shop_doesnt_deliver` whether that shop offers pickup.
 */
export type CheckoutRefusalDetails = {
  seller: { id: string; name: string }
  offers_pickup?: boolean
}

const PROMO_CODE_WORDS: Record<Exclude<PromoCodeRefusal, typeof PROMO_CODE_REFUSALS.otherShop>, string> = {
  [PROMO_CODE_REFUSALS.notFound]: "That isn't a valid promo code. Check it and try again.",
  [PROMO_CODE_REFUSALS.expired]: "That code has expired.",
  [PROMO_CODE_REFUSALS.notStarted]: "That code isn't on yet. Try it again once the deal starts.",
  [PROMO_CODE_REFUSALS.usedUp]: "That code has been used up.",
  [PROMO_CODE_REFUSALS.notApplicable]: "That code doesn't apply to the items in your cart.",
}

const isWordedPromoCode = (code: string): code is keyof typeof PROMO_CODE_WORDS =>
  Object.keys(PROMO_CODE_WORDS).includes(code)

/** A refusal's body as it may arrive: nothing in it is trusted until checked. */
type RefusalBody = { code?: unknown; seller?: { name?: unknown } | null; offers_pickup?: unknown }

/**
 * What the buyer is told of a coded checkout refusal, from the error response's body; null for
 * any other (no code, an unknown one, or one missing the shop it names), which the screen words
 * itself and reports.
 */
export function checkoutRefusalMessage(body: unknown): string | null {
  const { code, seller, offers_pickup }: RefusalBody = body && typeof body === "object" ? body : {}
  if (typeof code !== "string") return null
  if (isWordedPromoCode(code)) return PROMO_CODE_WORDS[code]
  const shop = seller && typeof seller === "object" ? seller.name : undefined
  if (typeof shop !== "string") return null
  if (code === PROMO_CODE_REFUSALS.otherShop) {
    return `That's ${shop}'s code. It only takes money off their items, and none in your cart qualify.`
  }
  if (code === SHOP_DOESNT_DELIVER) {
    const instead = offers_pickup === true ? "Use another address, collect the order in store, or" : "Use another address, or"
    return `${shop} doesn't deliver to this address. ${instead} remove ${shop}'s items.`
  }
  return null
}

/** A shop's part of the checkout, as far as starting a payment depends on it. */
export type PaymentShop = {
  seller: { name: string } | null
  method: "delivery" | "pickup" | null
  shop_status: { orderable: boolean; label: string } | null
  delivery_unavailable: { code: string } | null
}

/**
 * The checkout's blocker, in the order the API checks them: a shop not taking orders, a shop
 * no courier can deliver in time, a shop still to choose a delivery for. Null when the checkout
 * shows none, and the screen says it in its own words.
 */
export function paymentRefusal(checkout: { sellers: readonly PaymentShop[]; ready_to_pay: boolean }): string | null {
  const closed = checkout.sellers.find((g) => g.seller && g.shop_status && !g.shop_status.orderable)
  if (closed?.seller && closed.shop_status) return `${closed.seller.name} isn't taking orders now. ${closed.shop_status.label}.`
  const late = checkout.sellers.find((g) => g.seller && g.method === "delivery" && g.delivery_unavailable?.code === "perishable_too_slow")
  if (late?.seller) return `No courier can bring ${late.seller.name}'s fresh items in time. Collect them in store, or remove them.`
  if (!checkout.ready_to_pay) return "Choose how each shop's order reaches you before paying."
  return null
}
