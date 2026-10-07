import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { CreatePricesDTO, IPricingModuleService, MedusaContainer } from "@medusajs/framework/types"
import { MercurModules } from "@mercurjs/types"

/** An offer price as the vendor offer route takes it: kept by id, changed, or added without one. */
export type OfferPriceInput = {
  id?: string
  amount: number
  currency_code: string
  min_quantity?: number | null
  max_quantity?: number | null
  rules?: Record<string, string>
}

/** One of the offer's own prices as stored, enough to write it back. */
export type StoredOfferPrice = Required<Omit<OfferPriceInput, "rules">> & { rules: Record<string, string> }

export type OfferPriceSet = { offer_id: string; price_set_id: string; prices: StoredOfferPrice[] }

const pricing = (container: MedusaContainer) => container.resolve<IPricingModuleService>(Modules.PRICING)

/** The link row between an offer and one of its prices. */
export const offerPriceLink = (offer_id: string, price_id: string) => ({
  [MercurModules.OFFER]: { offer_id },
  [Modules.PRICING]: { price_id },
})

/** A price as the pricing module adds it to the variant's set, carrying the offer's `offer_id` rule. */
const toPricingInput = (offerId: string, p: OfferPriceInput): CreatePricesDTO & { id?: string } => ({
  ...(p.id ? { id: p.id } : {}),
  amount: p.amount,
  currency_code: p.currency_code,
  ...(p.min_quantity != null ? { min_quantity: p.min_quantity } : {}),
  ...(p.max_quantity != null ? { max_quantity: p.max_quantity } : {}),
  rules: { ...p.rules, offer_id: offerId },
})

/** Ids of the offer's prices in the set (those with its `offer_id` rule). */
async function offerPriceIds(container: MedusaContainer, priceSetId: string, offerId: string) {
  const prices = await pricing(container).listPrices({ price_set_id: [priceSetId] }, { relations: ["price_rules", "price_list"], take: null })
  return prices
    .filter((p) => !p.price_list && (p.price_rules ?? []).some((r) => r.attribute === "offer_id" && r.value === offerId))
    .map((p) => p.id)
}

/** Adds prices to the offer, returning the ids they were given. Not linked to the offer. */
async function addOfferPrices(container: MedusaContainer, offerId: string, priceSetId: string, prices: OfferPriceInput[]) {
  if (!prices.length) return []
  const before = new Set(await offerPriceIds(container, priceSetId, offerId))
  await pricing(container).addPrices({ priceSetId, prices: prices.map((p) => toPricingInput(offerId, p)) })
  return (await offerPriceIds(container, priceSetId, offerId)).filter((id) => !before.has(id))
}

/**
 * The offer's variant price set and the offer's own prices in it. Refuses a price id
 * in `prices` that isn't one of the offer's.
 */
export const getOfferPriceSetStep = createStep(
  "get-offer-price-set",
  async (input: { offer_id: string; prices: OfferPriceInput[] }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [offer] } = await query.graph({
      entity: "offer",
      fields: [
        "product_variant.price_set.id",
        "prices.id",
        "prices.amount",
        "prices.currency_code",
        "prices.min_quantity",
        "prices.max_quantity",
        "prices.price_rules.attribute",
        "prices.price_rules.value",
      ],
      filters: { id: input.offer_id },
    })
    if (!offer) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Offer ${input.offer_id} was not found`)
    const priceSetId = offer.product_variant?.price_set?.id
    if (!priceSetId) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Offer ${input.offer_id}'s variant has no price set`)

    // A link whose price no longer exists comes back as null; it isn't the offer's price.
    const prices: StoredOfferPrice[] = (offer.prices ?? []).filter((p: unknown) => !!p).map((p: any) => ({
      id: p.id,
      amount: Number(p.amount),
      currency_code: p.currency_code,
      min_quantity: p.min_quantity ?? null,
      max_quantity: p.max_quantity ?? null,
      rules: Object.fromEntries((p.price_rules ?? []).map((r: any) => [r.attribute, r.value])),
    }))
    const owned = new Set(prices.map((p) => p.id))
    const foreign = input.prices.find((p) => p.id && !owned.has(p.id))
    if (foreign) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Price ${foreign.id} does not belong to offer ${input.offer_id}`)

    return new StepResponse<OfferPriceSet>({ offer_id: input.offer_id, price_set_id: priceSetId, prices })
  }
)

/**
 * Unlinks and deletes the offer's prices whose ids aren't in `keep`. Undone by adding
 * them back (under new ids, since deleted ids can't be reused) and linking them.
 */
export const removeDroppedOfferPricesStep = createStep(
  "remove-dropped-offer-prices",
  async (input: { set: OfferPriceSet; keep: string[] }, { container }) => {
    const keep = new Set(input.keep)
    const dropped = input.set.prices.filter((p) => !keep.has(p.id))
    if (!dropped.length) return new StepResponse(undefined, null)
    const ids = dropped.map((p) => p.id)
    // Unlink first: a failure in between leaves an unused price rather than a link to nothing.
    await container.resolve(ContainerRegistrationKeys.LINK).dismiss(ids.map((id) => offerPriceLink(input.set.offer_id, id)))
    await pricing(container).removePrices(ids)
    return new StepResponse(undefined, { set: input.set, dropped })
  },
  async (undo, { container }) => {
    if (!undo) return
    const { offer_id, price_set_id } = undo.set
    const restored = await addOfferPrices(container, offer_id, price_set_id, undo.dropped.map(({ id: _id, ...p }) => p))
    if (restored.length) {
      await container.resolve(ContainerRegistrationKeys.LINK).create(restored.map((id) => offerPriceLink(offer_id, id)))
    }
  }
)

/**
 * Writes the offer's prices into the variant's shared set: those with an id are changed,
 * those without are added. Only the offer's prices are touched, never another shop's.
 * Returns the ids of the added prices, still to be linked. Undone by deleting the added
 * prices and writing the changed ones back (dropped ones are put back by their own step).
 */
export const upsertOfferPricesStep = createStep(
  "upsert-offer-prices",
  async (input: { set: OfferPriceSet; prices: OfferPriceInput[] }, { container }) => {
    const { offer_id, price_set_id } = input.set
    const created = await addOfferPrices(container, offer_id, price_set_id, input.prices)
    const kept = new Set(input.prices.map((p) => p.id))
    const changed = input.set.prices.filter((p) => kept.has(p.id))
    return new StepResponse(created, { offer_id, price_set_id, created, changed })
  },
  async (undo, { container }) => {
    if (!undo) return
    if (undo.created.length) await pricing(container).removePrices(undo.created)
    if (undo.changed.length) {
      await pricing(container).addPrices({
        priceSetId: undo.price_set_id,
        prices: undo.changed.map((p) => toPricingInput(undo.offer_id, p)),
      })
    }
  }
)
