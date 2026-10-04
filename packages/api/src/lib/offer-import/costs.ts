import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { offerImportService } from "./load"

export type OfferCostView = {
  offer_id: string
  /** What the shop paid, in major units. */
  amount: number
  currency_code: string
  /** The offer's selling price in the same currency, or null if it has none. */
  price: number | null
  /** Whether the offer sells below what it cost the shop. */
  below_cost: boolean
}

type Scope = Pick<MedusaContainer, "resolve">

/** The shop's cost on each of its offers that has one. Offers of other shops are never included. */
export async function loadOfferCosts(scope: Scope, sellerId: string, offerIds?: string[]): Promise<OfferCostView[]> {
  const costs = await offerImportService(scope).listOfferCosts({
    seller_id: sellerId,
    ...(offerIds && { offer_id: offerIds }),
  })
  if (!costs.length) return []
  const { data: offers } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "offer",
    fields: ["id", "prices.amount", "prices.currency_code"],
    filters: { id: costs.map((c) => c.offer_id), seller_id: sellerId },
  })
  const pricesOf = new Map(
    (offers as { id: string; prices?: { amount: number; currency_code: string }[] }[]).map((o) => [o.id, o.prices ?? []])
  )
  return costs.map((cost) => {
    const amount = Number(cost.amount)
    const price = pricesOf.get(cost.offer_id)?.find((p) => p.currency_code === cost.currency_code)
    const selling = price ? Number(price.amount) : null
    return {
      offer_id: cost.offer_id,
      amount,
      currency_code: cost.currency_code,
      price: selling,
      below_cost: selling !== null && selling < amount,
    }
  })
}
