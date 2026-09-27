import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { wrapOffersWithCalculatedPrices } from "@mercurjs/core/api/store/offers/helpers"
import { resolveVisibleSellerIds } from "@mercurjs/core/api/utils/sellers"
import { ProductStatus } from "@mercurjs/types"

// A listing is one shop's offer of one product: the product page and the feed are always
// in a shop's context, and prices are never compared across shops (docs/design.md).

export type ListingPrice = { calculated_amount: number; original_amount: number; currency_code: string }

export type ListingOffer = {
  id: string
  variant_id: string
  variant_title: string | null
  /** In the region's currency. `original_amount` above `calculated_amount` means a sale. */
  calculated_price: ListingPrice
}

export type ListingSeller = { id: string; name: string; handle: string }

export type ListingProduct = { id: string; title: string; handle: string; thumbnail: string | null }

export type ListingProductDetail = ListingProduct & {
  subtitle: string | null
  description: string | null
  /** Grams. */
  weight: number | null
  images: { id: string; url: string }[]
  attributes: { name: string; values: string[] }[]
}

export type Listing<P extends ListingProduct = ListingProduct> = {
  seller: ListingSeller
  product: P
  /** One per variant the shop sells, each at the shop's own price. */
  offers: ListingOffer[]
  /** Days until the shop ships: the slowest of its offers, else the shop's default. */
  leadtime_to_ship: number
}

export type ListingFilters = {
  regionId: string
  sellerId?: string
  productId?: string
  excludeProductId?: string
}

type Region = { id: string; currency_code: string; countries: string[] }
type SellerRow = ListingSeller & { default_leadtime_to_ship: number | null; address?: { country_code: string | null } | null }
type OfferRow = {
  id: string
  seller_id: string
  product_id: string
  variant_id: string
  leadtime_to_ship: number | null
  product_variant?: { id: string; title: string | null; price_set?: { id: string } | null } | null
  calculated_price?: (ListingPrice & Record<string, unknown>) | null
}

async function loadRegion(scope: MedusaContainer, regionId: string): Promise<Region> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code", "countries.iso_2"],
    filters: { id: regionId },
  })
  const region = data[0] as { id: string; currency_code: string; countries?: { iso_2: string }[] } | undefined
  if (!region) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Region ${regionId} not found`)
  return { id: region.id, currency_code: region.currency_code, countries: (region.countries ?? []).map((c) => c.iso_2) }
}

/** Open shops based in one of the region's countries. */
async function sellersServing(scope: MedusaContainer, region: Region, sellerId?: string) {
  const visible = await resolveVisibleSellerIds(scope)
  const ids = sellerId ? visible.filter((id) => id === sellerId) : visible
  if (!ids.length) return new Map<string, SellerRow>()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "seller",
    fields: ["id", "name", "handle", "default_leadtime_to_ship", "address.country_code"],
    filters: { id: ids },
  })
  const serving = (data as SellerRow[]).filter((s) => {
    const country = s.address?.country_code?.toLowerCase()
    return !!country && region.countries.includes(country)
  })
  return new Map(serving.map((s) => [s.id, s]))
}

async function publishedProductIds(scope: MedusaContainer, filters: ListingFilters): Promise<string[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { status: ProductStatus.PUBLISHED, ...(filters.productId ? { id: filters.productId } : {}) },
  })
  return (data as { id: string }[]).map((p) => p.id).filter((id) => id !== filters.excludeProductId)
}

/**
 * Offers visible in the region, each priced by Mercur's per-offer pricing (the variant's
 * price set scoped by the offer). An offer without a price in the region's currency is left out.
 */
async function pricedOffers(scope: MedusaContainer, region: Region, filters: ListingFilters) {
  const sellers = await sellersServing(scope, region, filters.sellerId)
  const productIds = sellers.size ? await publishedProductIds(scope, filters) : []
  if (!productIds.length) return { sellers, offers: [] as OfferRow[] }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "offer",
    fields: [
      "id",
      "seller_id",
      "product_id",
      "variant_id",
      "leadtime_to_ship",
      "product_variant.id",
      "product_variant.title",
      "product_variant.price_set.id",
    ],
    filters: { seller_id: [...sellers.keys()], product_id: productIds },
    pagination: { order: { created_at: "ASC", id: "ASC" } },
  })
  const offers = data as OfferRow[]
  await wrapOffersWithCalculatedPrices(
    { scope, pricingContext: { region_id: region.id, currency_code: region.currency_code } } as any,
    offers as any
  )
  return {
    sellers,
    offers: offers.filter(
      (o) => o.calculated_price?.calculated_amount != null && o.calculated_price.currency_code === region.currency_code
    ),
  }
}

/** Groups offers into one listing per shop and product, in the order they were first listed. */
function groupListings(sellers: Map<string, SellerRow>, offers: OfferRow[]) {
  const listings = new Map<string, { seller: SellerRow; productId: string; offers: OfferRow[] }>()
  for (const offer of offers) {
    const key = `${offer.seller_id}:${offer.product_id}`
    const listing = listings.get(key)
    if (listing) listing.offers.push(offer)
    else listings.set(key, { seller: sellers.get(offer.seller_id)!, productId: offer.product_id, offers: [offer] })
  }
  return [...listings.values()]
}

function toListing<P extends ListingProduct>(
  group: { seller: SellerRow; offers: OfferRow[] },
  product: P
): Listing<P> {
  const { seller, offers } = group
  const shopDefault = seller.default_leadtime_to_ship ?? 0
  return {
    seller: { id: seller.id, name: seller.name, handle: seller.handle },
    product,
    offers: offers.map((o) => ({
      id: o.id,
      variant_id: o.variant_id,
      variant_title: o.product_variant?.title ?? null,
      calculated_price: {
        calculated_amount: Number(o.calculated_price!.calculated_amount),
        original_amount: Number(o.calculated_price!.original_amount ?? o.calculated_price!.calculated_amount),
        currency_code: o.calculated_price!.currency_code,
      },
    })),
    leadtime_to_ship: Math.max(...offers.map((o) => o.leadtime_to_ship ?? shopDefault)),
  }
}

/**
 * Listings visible in a region, one per shop and product. Offers are grouped before paging,
 * so a page never splits a listing; fine at v1 catalogue sizes.
 */
export async function listListings(
  scope: MedusaContainer,
  filters: ListingFilters,
  page: { limit: number; offset: number }
): Promise<{ listings: Listing[]; count: number }> {
  const region = await loadRegion(scope, filters.regionId)
  const { sellers, offers } = await pricedOffers(scope, region, filters)
  const groups = groupListings(sellers, offers)
  const pageGroups = groups.slice(page.offset, page.offset + page.limit)
  if (!pageGroups.length) return { listings: [], count: groups.length }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "thumbnail"],
    filters: { id: [...new Set(pageGroups.map((g) => g.productId))] },
  })
  const products = new Map((data as ListingProduct[]).map((p) => [p.id, p]))
  return {
    listings: pageGroups.map((g) => toListing(g, products.get(g.productId)!)),
    count: groups.length,
  }
}

/** One shop's listing of one product, with the product's details, or not found. */
export async function retrieveListing(
  scope: MedusaContainer,
  filters: ListingFilters & { sellerId: string; productId: string }
): Promise<Listing<ListingProductDetail>> {
  const region = await loadRegion(scope, filters.regionId)
  const { sellers, offers } = await pricedOffers(scope, region, filters)
  const [group] = groupListings(sellers, offers)
  if (!group) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "This shop doesn't sell that product in your region")
  }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [product],
  } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "thumbnail", "subtitle", "description", "weight", "images.id", "images.url"],
    filters: { id: filters.productId },
  })
  // Attribute values are read on their own: mixing attribute links with product-module
  // relations in one graph query is unreliable (see lib/product-completeness/load.ts).
  const {
    data: [withAttributes],
  } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "product_attribute_values.name",
      "product_attribute_values.attribute.id",
      "product_attribute_values.attribute.name",
      "product_attribute_values.attribute.rank",
    ],
    filters: { id: filters.productId },
  })
  const p = product as any
  return toListing(group, {
    id: p.id,
    title: p.title,
    handle: p.handle,
    thumbnail: p.thumbnail ?? null,
    subtitle: p.subtitle ?? null,
    description: p.description ?? null,
    weight: p.weight == null ? null : Number(p.weight),
    images: (p.images ?? []).map((i: { id: string; url: string }) => ({ id: i.id, url: i.url })),
    attributes: attributesOf((withAttributes as any)?.product_attribute_values ?? []),
  })
}

type AttributeValueRow = { name: string; attribute?: { id: string; name: string; rank: number | null } | null }

function attributesOf(values: AttributeValueRow[]): { name: string; values: string[] }[] {
  const byAttribute = new Map<string, { name: string; rank: number; values: string[] }>()
  for (const value of values) {
    const attribute = value?.attribute
    if (!attribute) continue
    const entry = byAttribute.get(attribute.id) ?? { name: attribute.name, rank: attribute.rank ?? 0, values: [] }
    entry.values.push(value.name)
    byAttribute.set(attribute.id, entry)
  }
  return [...byAttribute.values()].sort((a, b) => a.rank - b.rank).map(({ name, values }) => ({ name, values }))
}
