import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, PriceListStatus, PriceListType } from "@medusajs/framework/utils"

type Scope = Pick<MedusaContainer, "resolve">

/** The price list a shop's imported sale prices go in, when its offer isn't already on sale (#46). */
export const IMPORTED_SALE_LIST = {
  title: "Imported sale prices",
  description: "Sale prices from your product list imports.",
}

/** A sale price on one of the shop's offers: a price in one of its price lists, with the offer's `offer_id` rule. */
export type OfferSalePrice = { id: string; price_list_id: string; amount: number }

export type ShopSales = {
  /** The sale price buyers see on each offer that has one (its lowest), by offer id. */
  by_offer: Map<string, OfferSalePrice>
  /** The shop's running list of imported sale prices, if it has one. */
  import_list_id: string | null
}

type SaleList = {
  id: string
  title: string
  starts_at: string | Date | null
  ends_at: string | Date | null
  prices?: { id: string; amount: number; currency_code: string; price_rules?: { attribute: string; value: string }[] | null }[] | null
}

/** Whether a list's dates, if it has any, are around now. */
const running = (list: SaleList, now: Date) =>
  (!list.starts_at || new Date(list.starts_at) <= now) && (!list.ends_at || new Date(list.ends_at) > now)

/**
 * The shop's running sale prices in the currency, by offer. A shop's sale prices are its active
 * sale price lists' prices, each kept to one of its offers by an `offer_id` rule (#10), so other
 * shops' offers of the same product are never read or changed.
 */
export async function loadShopSales(scope: Scope, sellerId: string, currency: string, now = new Date()): Promise<ShopSales> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({ entity: "price_list_seller", fields: ["price_list_id"], filters: { seller_id: sellerId } })
  const ids = (links as { price_list_id: string }[]).map((l) => l.price_list_id)
  if (!ids.length) return { by_offer: new Map(), import_list_id: null }

  const { data } = await query.graph({
    entity: "price_list",
    fields: [
      "id",
      "title",
      "starts_at",
      "ends_at",
      "prices.id",
      "prices.amount",
      "prices.currency_code",
      "prices.price_rules.attribute",
      "prices.price_rules.value",
    ],
    filters: { id: ids, type: PriceListType.SALE, status: PriceListStatus.ACTIVE },
  })
  const lists = (data as SaleList[]).filter((l) => running(l, now))

  const byOffer = new Map<string, OfferSalePrice>()
  for (const list of lists) {
    for (const price of list.prices ?? []) {
      const offerId = price.price_rules?.find((r) => r.attribute === "offer_id")?.value
      if (!offerId || price.currency_code !== currency) continue
      const amount = Number(price.amount)
      const lowest = byOffer.get(offerId)
      if (!lowest || amount < lowest.amount) byOffer.set(offerId, { id: price.id, price_list_id: list.id, amount })
    }
  }
  return { by_offer: byOffer, import_list_id: lists.find((l) => l.title === IMPORTED_SALE_LIST.title)?.id ?? null }
}
