import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { IPricingModuleService, MedusaContainer } from "@medusajs/framework/types"
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

type OwnedPrice = {
  id: string
  amount: number
  currency_code: string
  min_quantity: number | null
  max_quantity: number | null
  rules: Record<string, string>
}

type PricesUndo = {
  offer_id: string
  price_set_id: string
  /** The offer's prices before the step, to put back. */
  before: OwnedPrice[]
  created: string[]
  removed: string[]
}

const pricing = (container: MedusaContainer) => container.resolve<IPricingModuleService>(Modules.PRICING)
const offerPriceLink = (offer_id: string, price_id: string) => ({
  [MercurModules.OFFER]: { offer_id },
  [Modules.PRICING]: { price_id },
})

/** The offer's variant price set and the offer's own prices in it. */
async function offerPrices(container: MedusaContainer, offerId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [offer] } = await query.graph({
    entity: "offer",
    fields: [
      "id",
      "product_variant.price_set.id",
      "prices.id",
      "prices.amount",
      "prices.currency_code",
      "prices.min_quantity",
      "prices.max_quantity",
      "prices.price_rules.attribute",
      "prices.price_rules.value",
    ],
    filters: { id: offerId },
  })
  if (!offer) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Offer ${offerId} was not found`)
  const priceSetId = offer.product_variant?.price_set?.id
  if (!priceSetId) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Offer ${offerId}'s variant has no price set`)
  // A link whose price no longer exists comes back as null; it isn't the offer's price.
  const owned: OwnedPrice[] = ((offer.prices ?? []) as any[]).filter(Boolean).map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    currency_code: p.currency_code,
    min_quantity: p.min_quantity ?? null,
    max_quantity: p.max_quantity ?? null,
    rules: Object.fromEntries((p.price_rules ?? []).map((r: any) => [r.attribute, r.value])),
  }))
  return { priceSetId: priceSetId as string, owned }
}

const asPricingInput = (offerId: string, p: Omit<OfferPriceInput, "id"> & { id?: string }) => ({
  ...(p.id ? { id: p.id } : {}),
  amount: p.amount,
  currency_code: p.currency_code,
  ...(p.min_quantity != null ? { min_quantity: p.min_quantity } : {}),
  ...(p.max_quantity != null ? { max_quantity: p.max_quantity } : {}),
  rules: { ...(p.rules ?? {}), offer_id: offerId },
})

/** Adds prices to the set and links the new ones to the offer; returns their ids. */
async function addOfferPrices(container: MedusaContainer, offerId: string, priceSetId: string, prices: OfferPriceInput[], before: Set<string>) {
  if (!prices.length) return []
  await pricing(container).addPrices({ priceSetId, prices: prices.map((p) => asPricingInput(offerId, p)) as any })
  const created = (await pricing(container).listPrices({ price_set_id: priceSetId, price_list_id: null } as any, { relations: ["price_rules"], take: null }))
    .filter((p: any) => !before.has(p.id) && (p.price_rules ?? []).some((r: any) => r.attribute === "offer_id" && r.value === offerId))
    .map((p) => p.id)
  if (created.length) {
    await container.resolve(ContainerRegistrationKeys.LINK).create(created.map((id) => offerPriceLink(offerId, id)))
  }
  return created
}

async function removeOfferPrices(container: MedusaContainer, offerId: string, ids: string[]) {
  if (!ids.length) return
  // Unlink first: a failure in between leaves an unused price rather than a link to nothing.
  await container.resolve(ContainerRegistrationKeys.LINK).dismiss(ids.map((id) => offerPriceLink(offerId, id)))
  await pricing(container).removePrices(ids)
}

/**
 * Sets an offer's own prices to `prices`: keeps and changes those with an id, adds those
 * without, and removes the ones left out. Unlike Mercur's `updateOffersWorkflow`, which
 * writes the variant's whole shared price set and so deletes every other shop's price for
 * it (#84), this touches only the offer's prices. Undone if a later step fails.
 */
export const setOfferPricesStep = createStep(
  "set-offer-prices",
  async (input: { offer_id: string; prices: OfferPriceInput[] }, { container }) => {
    const { priceSetId, owned } = await offerPrices(container, input.offer_id)
    const ownedIds = new Set(owned.map((p) => p.id))
    const foreign = input.prices.find((p) => p.id && !ownedIds.has(p.id))
    if (foreign) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Price ${foreign.id} does not belong to offer ${input.offer_id}`)

    const kept = new Set(input.prices.map((p) => p.id).filter(Boolean))
    const removed = owned.filter((p) => !kept.has(p.id)).map((p) => p.id)
    const undo: PricesUndo = { offer_id: input.offer_id, price_set_id: priceSetId, before: owned, created: [], removed: [] }

    const existing = new Set((await pricing(container).listPrices({ price_set_id: priceSetId } as any, { take: null })).map((p) => p.id))
    undo.created = await addOfferPrices(container, input.offer_id, priceSetId, input.prices, existing)
    await removeOfferPrices(container, input.offer_id, removed)
    undo.removed = removed
    return new StepResponse(undefined, undo)
  },
  async (undo, { container }) => {
    if (!undo) return
    await removeOfferPrices(container, undo.offer_id, undo.created)
    const removed = new Set(undo.removed)
    const changed = undo.before.filter((p) => !removed.has(p.id))
    if (changed.length) {
      await pricing(container).addPrices({ priceSetId: undo.price_set_id, prices: changed.map((p) => asPricingInput(undo.offer_id, p)) as any })
    }
    const existing = new Set((await pricing(container).listPrices({ price_set_id: undo.price_set_id } as any, { take: null })).map((p) => p.id))
    // A removed price can't come back under its old id; it's added again and linked.
    await addOfferPrices(
      container,
      undo.offer_id,
      undo.price_set_id,
      undo.before.filter((p) => removed.has(p.id)).map(({ id: _id, ...p }) => p),
      existing
    )
  }
)
