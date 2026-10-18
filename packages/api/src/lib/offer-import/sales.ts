import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, PriceListStatus, PriceListType } from "@medusajs/framework/utils"

type Scope = Pick<MedusaContainer, "resolve">

/** The price list a shop's imported sale prices go in (#46), made the first time an import needs it. */
export const IMPORTED_SALE_LIST = {
  title: "Imported sale prices",
  description: "Sale prices from your product list imports.",
}

/** A sale price on one of the shop's offers: a price in its imported sale list, with the offer's `offer_id` rule. */
export type OfferSalePrice = { id: string; amount: number }

/**
 * The shop's imported sale prices: its running "Imported sale prices" list, if it has one, and
 * its prices by offer. An import reads and changes only these, never a sale the shop made itself.
 */
export type ImportedSales = {
  list_id: string | null
  by_offer: Map<string, OfferSalePrice>
}

type SaleList = {
  id: string
  starts_at: string | Date | null
  ends_at: string | Date | null
  prices?: { id: string; amount: number; currency_code: string; price_rules?: { attribute: string; value: string }[] | null }[] | null
}

/** Whether a list's dates, if it has any, are around now. */
const running = (list: SaleList, now: Date) =>
  (!list.starts_at || new Date(list.starts_at) <= now) && (!list.ends_at || new Date(list.ends_at) > now)

/**
 * The shop's imported sale prices in the currency, by offer. Each is kept to one of its offers
 * by an `offer_id` rule (#10), so other shops' offers of the same product are never read or
 * changed.
 */
export async function loadImportedSales(scope: Scope, sellerId: string, currency: string, now = new Date()): Promise<ImportedSales> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({ entity: "price_list_seller", fields: ["price_list_id"], filters: { seller_id: sellerId } })
  const ids = (links as { price_list_id: string }[]).map((l) => l.price_list_id)
  if (!ids.length) return { list_id: null, by_offer: new Map() }

  const { data } = await query.graph({
    entity: "price_list",
    fields: ["id", "starts_at", "ends_at", "prices.id", "prices.amount", "prices.currency_code", "prices.price_rules.attribute", "prices.price_rules.value"],
    filters: { id: ids, title: IMPORTED_SALE_LIST.title, type: PriceListType.SALE, status: PriceListStatus.ACTIVE },
  })
  const list = (data as SaleList[]).find((l) => running(l, now))
  if (!list) return { list_id: null, by_offer: new Map() }

  const byOffer = new Map<string, OfferSalePrice>()
  for (const price of list.prices ?? []) {
    const offerId = price.price_rules?.find((r) => r.attribute === "offer_id")?.value
    if (offerId && price.currency_code === currency) byOffer.set(offerId, { id: price.id, amount: Number(price.amount) })
  }
  return { list_id: list.id, by_offer: byOffer }
}
