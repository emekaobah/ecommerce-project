import type { ComputeActionContext, MedusaContainer } from "@medusajs/framework/types"
import {
  ApplicationMethodTargetType,
  ComputedActions,
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { wrapOffersWithCalculatedPrices } from "@mercurjs/core/api/store/offers/helpers"
import { pinOf, roundedDistanceKm, type Pin, type ShopDeal } from "@oja/domain"
import { availableQuantities } from "./availability"
import { collectionPointsOf } from "./collection-point"
import { attributionOf, type Attribution } from "./enrichment"
import { rankListingPage, rankShopPage, shopDistancesKm, type RankedListing, type RankingFilters } from "./listing-ranking"
import { perishableProductIds } from "./perishable"
import { isLive, liveSellerIds } from "./onboarding"
import { shopStatusesOf, type ShopStatusView } from "./shop-hours"

// A listing is one shop's offer of one product: the product page and the feed are always
// in a shop's context, and prices are never compared across shops (docs/design.md).
// Postgres filters, ranks and pages them (`./listing-ranking`, ADR 0014); only a page's
// listings are loaded, priced and given their deals here.

export type ListingPrice = { calculated_amount: number; original_amount: number; currency_code: string }

export type ListingOffer = {
  id: string
  variant_id: string
  variant_title: string | null
  /** In the region's currency. `original_amount` above `calculated_amount` means a sale. */
  calculated_price: ListingPrice
  /** How many can still be ordered (0: sold out); null when the shop doesn't track its stock or takes backorders. */
  available_quantity: number | null
}

/** The shop a listing belongs to, with what its header shows wherever it appears. */
export type ListingSeller = {
  id: string
  name: string
  handle: string
  /** The logo and banner the shop uploads in the vendor web panel; null when it hasn't, and screens show its initials. */
  logo: string | null
  banner: string | null
  /** Where the shop is: its pickup address's `city`, which holds the LGA in Nigeria's address form (ADR 0002). */
  area: string | null
  /** The shop's usual days to ship; null when it hasn't set one. */
  default_leadtime_to_ship: number | null
  /**
   * How far the shop is from the buyer's delivery address, in whole kilometres (0 is under 1 km);
   * null without an address to measure from. Never the shop's coordinates (ADR 0011).
   */
  distance_km: number | null
  /**
   * Open, closed outside its hours (still orderable, with when it opens), or closed until it
   * reopens (an exception or pause: not orderable, with its note). ADR 0004.
   */
  shop_status: ShopStatusView
  /**
   * In-store pickup, when the shop has a collection point (#12, #94): where it is, as the
   * collection point's `city` (the LGA in Nigeria's form, ADR 0002). Null when the shop doesn't
   * offer pickup.
   */
  pickup: ListingPickup | null
}

/** Where a shop's buyers collect, as listings and shop pages say it; never the address itself. */
export type ListingPickup = { area: string | null }

/** A shop's page header. */
export type Shop = ListingSeller & { description: string | null }

export type ListingProduct = { id: string; title: string; handle: string; thumbnail: string | null }

export type ListingProductDetail = ListingProduct & {
  subtitle: string | null
  description: string | null
  /** Grams. */
  weight: number | null
  images: { id: string; url: string }[]
  attributes: { name: string; values: string[] }[]
  /** Credits the product page must show for data it took from product databases (#35). */
  attribution: Attribution[]
  /** Fresh or chilled: delivered only by the end of the next day (#69). */
  perishable: boolean
}

/** One of the shop's automatic promotions that applies to the listing's product (#6), for its badge. */
export type ListingDeal = ShopDeal & { promotion_id: string }

export type Listing<P extends ListingProduct = ListingProduct> = {
  seller: ListingSeller
  product: P
  /** One per variant the shop sells, each at the shop's own price. */
  offers: ListingOffer[]
  /** The shop's own automatic promotions that apply to the product; never another shop's. */
  deals: ListingDeal[]
  /** Days until the shop ships: the slowest of its offers, else the shop's default; null when neither is set. */
  leadtime_to_ship: number | null
}

export type ListingFilters = {
  regionId: string
  /** The publishable key's sales channels; products outside them are never listed. */
  salesChannelIds: string[]
  /** Words the product's name must all hold, ignoring case. */
  search?: string
  /** Products in this category or any category below it. */
  categoryId?: string
  sellerId?: string
  productId?: string
  /** Only these listings, by shop and product (a buyer's wishlist). */
  pairs?: { seller_id: string; product_id: string }[]
  excludeProductId?: string
  /** The pin of the buyer's delivery address, which listings rank nearest first from (ADR 0011). */
  deliveringTo?: Pin | null
}

type Region = { id: string; currency_code: string; countries: string[] }
type SellerRow = Omit<Shop, "area" | "shop_status" | "distance_km" | "pickup"> & {
  address?: { country_code: string | null; city: string | null } | null
  shop_status: ShopStatusView
  pickup: ListingPickup | null
  /**
   * Straight-line kilometres from the buyer's delivery address to the shop's pickup pin, unrounded
   * (buyers see `distance_km`, rounded); null without either.
   */
  exact_km: number | null
}
/** Mercur's calculated price; the pricing module's fields beyond `ListingPrice` pass through untyped. */
type CalculatedOfferPrice = ListingPrice & { is_calculated_price_tax_inclusive?: boolean } & Record<string, unknown>
type OfferPricingRow = {
  id: string
  product_variant?: { price_set?: { id: string } | null } | null
  calculated_price?: CalculatedOfferPrice | null
}
type OfferRow = OfferPricingRow & {
  seller_id: string
  product_id: string
  variant_id: string
  product_variant?: { id: string; title: string | null; price_set?: { id: string } | null } | null
}
type PricedOfferRow = OfferRow & { calculated_price: CalculatedOfferPrice; available_quantity: number | null }
type ProductDetailRow = Omit<ListingProductDetail, "attributes" | "attribution" | "weight"> & { weight: number | string | null }

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

/**
 * A category and every category below it that buyers can see: active and not internal.
 * A hidden category hides the branch beneath it. Empty when the category itself is hidden or unknown.
 */
async function categoryTree(scope: MedusaContainer, categoryId: string): Promise<string[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_category",
    fields: ["id", "parent_category_id"],
    filters: { is_active: true, is_internal: false },
  })
  const categories = data as { id: string; parent_category_id: string | null }[]
  if (!categories.some((c) => c.id === categoryId)) return []
  const tree = [categoryId]
  // An array's iterator also visits what is pushed during the loop, so this walks every level.
  for (const id of tree) {
    tree.push(...categories.filter((c) => c.parent_category_id === id).map((c) => c.id))
  }
  return tree
}

const searchWords = (search: string | undefined) => search?.toLowerCase().split(/\s+/).filter(Boolean) ?? []

/**
 * What the database ranks listings by for the request: live shops (closed ones too, marked
 * closed, ADR 0004), narrowed to one shop when asked, and the product filters.
 */
export async function rankingFiltersOf(
  scope: MedusaContainer,
  region: Region,
  filters: ListingFilters
): Promise<RankingFilters> {
  const live = await liveSellerIds(scope)
  return {
    sellerIds: filters.sellerId ? live.filter((id) => id === filters.sellerId) : live,
    countries: region.countries.map((c) => c.toLowerCase()),
    regionId: region.id,
    currencyCode: region.currency_code,
    salesChannelIds: filters.salesChannelIds,
    words: searchWords(filters.search),
    categoryIds: filters.categoryId ? await categoryTree(scope, filters.categoryId) : undefined,
    productIds: filters.productId ? [filters.productId] : undefined,
    excludeProductId: filters.excludeProductId,
    pairs: filters.pairs,
    from: filters.deliveringTo,
  }
}

/** The shops' headers, with whether they are open now, whether they offer pickup, and how far they are (`exact_km`). */
async function sellerRows(scope: MedusaContainer, kmBySeller: Map<string, number | null>): Promise<Map<string, SellerRow>> {
  const ids = [...kmBySeller.keys()]
  if (!ids.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "seller",
    fields: [
      "id",
      "name",
      "handle",
      "logo",
      "banner",
      "description",
      "default_leadtime_to_ship",
      "address.country_code",
      "address.city",
    ],
    filters: { id: ids },
  })
  const [statuses, collectionPoints] = await Promise.all([shopStatusesOf(scope, ids), collectionPointsOf(scope, ids)])
  return new Map(
    (data as unknown as Omit<SellerRow, "shop_status" | "exact_km" | "pickup">[]).map((s) => {
      const point = collectionPoints.get(s.id)
      return [
        s.id,
        {
          ...s,
          shop_status: statuses.get(s.id)!,
          pickup: point ? { area: point.address.city } : null,
          exact_km: kmBySeller.get(s.id) ?? null,
        },
      ]
    })
  )
}

/**
 * Prices each offer at its own shop's price in the region: Mercur's per-offer pricing (the
 * variant's price set scoped by the offer), so two shops' offers of one variant never share a
 * price. Needs `product_variant.price_set.id`; an offer without a price in the region's currency is left out.
 */
export async function priceOffers<O extends OfferPricingRow>(
  scope: MedusaContainer,
  region: { id: string; currency_code: string },
  offers: O[]
): Promise<(O & { calculated_price: CalculatedOfferPrice })[]> {
  // Mercur's helper reads only the request's scope and pricing context.
  const pricingRequest = { scope, pricingContext: { region_id: region.id, currency_code: region.currency_code } }
  await wrapOffersWithCalculatedPrices(pricingRequest as never, offers as never)
  return offers.filter(
    (o): o is O & { calculated_price: CalculatedOfferPrice } =>
      o.calculated_price?.calculated_amount != null && o.calculated_price.currency_code === region.currency_code
  )
}

type ListingGroup = { seller: SellerRow; productId: string; offers: PricedOfferRow[]; leadtime_to_ship: number | null }

const dealKey = (sellerId: string, productId: string) => `${sellerId}:${productId}`

/**
 * The ranked listings, in their order, each with its shop and its offers priced in the region,
 * in the order they were listed. A listing none of whose offers Mercur could price is left out.
 */
async function groupsOf(
  scope: MedusaContainer,
  region: Region,
  ranked: RankedListing[],
  sellers?: Map<string, SellerRow>
): Promise<ListingGroup[]> {
  if (!ranked.length) return []
  sellers ??= await sellerRows(scope, new Map(ranked.map((r) => [r.seller_id, r.exact_km])))
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "offer",
    fields: ["id", "seller_id", "product_id", "variant_id", "product_variant.id", "product_variant.title", "product_variant.price_set.id"],
    filters: { seller_id: [...sellers.keys()], product_id: [...new Set(ranked.map((r) => r.product_id))] },
    pagination: { order: { created_at: "ASC", id: "ASC" } },
  })
  const onPage = new Set(ranked.map((r) => dealKey(r.seller_id, r.product_id)))
  const pageOffers = (data as OfferRow[]).filter((o) => onPage.has(dealKey(o.seller_id, o.product_id)))
  const [priced, available] = await Promise.all([
    priceOffers(scope, region, pageOffers),
    availableQuantities(scope, pageOffers.map((o) => o.id)),
  ])
  const offers = new Map<string, PricedOfferRow[]>()
  for (const offer of priced) {
    const key = dealKey(offer.seller_id, offer.product_id)
    offers.set(key, [...(offers.get(key) ?? []), { ...offer, available_quantity: available.get(offer.id) ?? null }])
  }
  return ranked.flatMap((r) => {
    const seller = sellers.get(r.seller_id)
    const priced = offers.get(dealKey(r.seller_id, r.product_id))
    if (!seller || !priced) return []
    return [{ seller, productId: r.product_id, offers: priced, leadtime_to_ship: r.leadtime_to_ship }]
  })
}

function toListingSeller(seller: SellerRow): ListingSeller {
  return {
    id: seller.id,
    name: seller.name,
    handle: seller.handle,
    logo: seller.logo ?? null,
    banner: seller.banner ?? null,
    area: seller.address?.city ?? null,
    default_leadtime_to_ship: seller.default_leadtime_to_ship,
    shop_status: seller.shop_status,
    pickup: seller.pickup,
    distance_km: seller.exact_km == null ? null : roundedDistanceKm(seller.exact_km),
  }
}

function toListing<P extends ListingProduct>(group: ListingGroup, product: P, deals: ListingDeal[]): Listing<P> {
  const { seller, offers } = group
  return {
    seller: toListingSeller(seller),
    product,
    offers: offers.map(({ id, variant_id, product_variant, calculated_price, available_quantity }) => ({
      id,
      variant_id,
      variant_title: product_variant?.title ?? null,
      calculated_price: {
        calculated_amount: Number(calculated_price.calculated_amount),
        original_amount: Number(calculated_price.original_amount ?? calculated_price.calculated_amount),
        currency_code: calculated_price.currency_code,
      },
      available_quantity,
    })),
    leadtime_to_ship: group.leadtime_to_ship,
    deals,
  }
}

type AutomaticPromotion = {
  id: string
  code: string
  type: string
  seller?: { id: string } | null
  rules?: { attribute: string }[] | null
  application_method?: {
    type: ShopDeal["type"]
    value: number | string
    currency_code: string | null
    allocation: ShopDeal["allocation"]
    target_type: string
  } | null
}
type DealProduct = {
  id: string
  collection_id: string | null
  type_id: string | null
  categories?: { id: string }[] | null
  tags?: { id: string }[] | null
}

/**
 * What the deals' cart holds that is the same for every listing on a page. A promotion whose
 * conditions ask about anything else (the buyer, or the rest of the cart) gets no badge.
 */
const PAGE_WIDE_RULES = new Set(["currency_code", "region_id", "region.id", "sales_channel_id", "shipping_address.country_code"])

/**
 * Each listing's deals, by `dealKey`: its shop's running automatic promotions that would take
 * something off one of the product's offers. Worked out once for the page, as one cart holding
 * one of each offer on it; each item keeps only its own shop's promotions.
 */
async function dealsOf(
  scope: MedusaContainer,
  region: Region,
  filters: Pick<ListingFilters, "salesChannelIds">,
  groups: ListingGroup[]
): Promise<Map<string, ListingDeal[]>> {
  const deals = new Map<string, ListingDeal[]>()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "promotion",
    fields: [
      "id",
      "code",
      "type",
      "seller.id",
      "rules.attribute",
      "application_method.type",
      "application_method.value",
      "application_method.currency_code",
      "application_method.allocation",
      "application_method.target_type",
    ],
    filters: { is_automatic: true, status: "active", type: "standard" },
  })
  const sellerIds = new Set(groups.map((g) => g.seller.id))
  const promotions = (data as unknown as AutomaticPromotion[]).filter(
    (p) =>
      p.seller &&
      sellerIds.has(p.seller.id) &&
      p.application_method &&
      p.application_method.target_type !== ApplicationMethodTargetType.SHIPPING_METHODS &&
      (!p.application_method.currency_code || p.application_method.currency_code === region.currency_code) &&
      (p.rules ?? []).every((r) => PAGE_WIDE_RULES.has(r.attribute))
  )
  const withDeals = groups.filter((g) => promotions.some((p) => p.seller!.id === g.seller.id))
  if (!withDeals.length) return deals

  const { data: productRows } = await query.graph({
    entity: "product",
    fields: ["id", "collection_id", "type_id", "categories.id", "tags.id"],
    filters: { id: [...new Set(withDeals.map((g) => g.productId))] },
  })
  const products = new Map((productRows as unknown as DealProduct[]).map((p) => [p.id, p]))
  const groupOfOffer = new Map(withDeals.flatMap((g) => g.offers.map((o) => [o.id, g] as const)))
  const items = withDeals.flatMap((group) => {
    const product = products.get(group.productId)
    if (!product) return []
    return group.offers.map((offer) => {
      const amount = Number(offer.calculated_price.calculated_amount)
      return {
        id: offer.id,
        quantity: 1,
        subtotal: amount,
        original_total: amount,
        is_discountable: true,
        product_id: product.id,
        variant_id: offer.variant_id,
        metadata: { offer_id: offer.id },
        product: {
          id: product.id,
          collection_id: product.collection_id,
          type_id: product.type_id,
          categories: product.categories ?? [],
          tags: product.tags ?? [],
        },
      }
    })
  })
  const context = {
    currency_code: region.currency_code,
    region_id: region.id,
    region: { id: region.id },
    sales_channel_id: filters.salesChannelIds[0],
    shipping_address: { country_code: region.countries[0] },
    items,
    shipping_methods: [],
  }
  const actions = await scope.resolve(Modules.PROMOTION).computeActions([], context as unknown as ComputeActionContext)

  const byCode = new Map(promotions.map((p) => [p.code, p]))
  for (const action of actions) {
    if (action.action !== ComputedActions.ADD_ITEM_ADJUSTMENT) continue
    const group = groupOfOffer.get(action.item_id)
    const promotion = byCode.get(action.code)
    // Only a shop's own promotions badge its listings.
    if (!group || promotion?.seller!.id !== group.seller.id) continue
    const key = dealKey(group.seller.id, group.productId)
    const listed = deals.get(key) ?? []
    if (listed.some((d) => d.promotion_id === promotion.id)) continue
    deals.set(key, [
      ...listed,
      {
        promotion_id: promotion.id,
        type: promotion.application_method!.type,
        value: Number(promotion.application_method!.value),
        allocation: promotion.application_method!.allocation,
        currency_code: promotion.application_method!.currency_code ?? region.currency_code,
      },
    ])
  }
  return deals
}

/**
 * Listings visible in a region, one per shop and product, in the documented order (ADR 0011), a
 * page at a time; with how many listings match in all, and from how many shops (search's counts).
 */
export async function listListings(
  scope: MedusaContainer,
  filters: ListingFilters,
  page: { limit: number; offset: number }
): Promise<{ listings: Listing[]; count: number; shopCount: number }> {
  const region = await loadRegion(scope, filters.regionId)
  const ranked = await rankListingPage(scope, await rankingFiltersOf(scope, region, filters), page)
  const groups = await groupsOf(scope, region, ranked.listings)
  return { listings: await listingsOf(scope, region, filters, groups), count: ranked.count, shopCount: ranked.shopCount }
}

/** The groups as listings, with their products and deals. */
async function listingsOf(
  scope: MedusaContainer,
  region: Region,
  filters: Pick<ListingFilters, "salesChannelIds">,
  groups: ListingGroup[]
): Promise<Listing[]> {
  if (!groups.length) return []
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "thumbnail"],
    filters: { id: [...new Set(groups.map((g) => g.productId))] },
  })
  const products = new Map((data as ListingProduct[]).map((p) => [p.id, p]))
  const deals = await dealsOf(scope, region, filters, groups)
  return groups.map((g) => toListing(g, products.get(g.productId)!, deals.get(dealKey(g.seller.id, g.productId)) ?? []))
}

/** How many listings each shop on Home shows: its first in feed order. */
const LISTINGS_PER_SHOP = 3

/** A listing within its shop on Home, which already names the shop. */
export type ShopListing = Omit<Listing, "seller">

/** A shop on Home: its header, its top listings in feed order, and how many listings it has. */
export type ShopWithListings = ListingSeller & { listings: ShopListing[]; listing_count: number }

/**
 * Shops serving the region, each once, in the order their first listings come in the feed
 * (ADR 0011, 0014), a page at a time; each with its first few listings.
 */
export async function listShops(
  scope: MedusaContainer,
  filters: Pick<ListingFilters, "regionId" | "salesChannelIds" | "categoryId" | "deliveringTo">,
  page: { limit: number; offset: number }
): Promise<{ shops: ShopWithListings[]; count: number }> {
  const region = await loadRegion(scope, filters.regionId)
  const ranked = await rankShopPage(scope, await rankingFiltersOf(scope, region, filters), page, LISTINGS_PER_SHOP)
  const sellers = await sellerRows(scope, new Map(ranked.shops.map((s) => [s.seller_id, s.exact_km])))
  const groups = await groupsOf(
    scope,
    region,
    ranked.shops.flatMap((s) => s.listings),
    sellers
  )
  const listings = await listingsOf(scope, region, filters, groups)
  return {
    count: ranked.count,
    shops: ranked.shops.flatMap((s) => {
      const seller = sellers.get(s.seller_id)
      if (!seller) return []
      return [
        {
          ...toListingSeller(seller),
          listing_count: s.listing_count,
          listings: listings.filter((l) => l.seller.id === s.seller_id).map(({ seller: _, ...listing }) => listing),
        },
      ]
    }),
  }
}

/** One shop's listing of one product, with the product's details, or not found. */
export async function retrieveListing(
  scope: MedusaContainer,
  filters: ListingFilters & { sellerId: string; productId: string }
): Promise<Listing<ListingProductDetail>> {
  const region = await loadRegion(scope, filters.regionId)
  const ranked = await rankListingPage(scope, await rankingFiltersOf(scope, region, filters), { limit: 1, offset: 0 })
  const [group] = await groupsOf(scope, region, ranked.listings)
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
  const p = product as unknown as ProductDetailRow
  const attributeValues = (withAttributes as { product_attribute_values?: AttributeValueRow[] } | undefined)
    ?.product_attribute_values
  const [attribution, perishable, deals] = await Promise.all([
    attributionOf(scope, p.id),
    perishableProductIds(scope, [p.id]),
    dealsOf(scope, region, filters, [group]),
  ])
  return toListing(
    group,
    {
      id: p.id,
      title: p.title,
      handle: p.handle,
      thumbnail: p.thumbnail ?? null,
      subtitle: p.subtitle ?? null,
      description: p.description ?? null,
      weight: p.weight == null ? null : Number(p.weight),
      images: (p.images ?? []).map(({ id, url }) => ({ id, url })),
      attributes: attributesOf(attributeValues ?? []),
      attribution,
      perishable: perishable.has(p.id),
    },
    deals.get(dealKey(group.seller.id, group.productId)) ?? []
  )
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

/** A live shop serving the region, open or closed (ADR 0004), for its page's header, or not found. */
export async function retrieveShop(
  scope: MedusaContainer,
  filters: Pick<ListingFilters, "regionId" | "deliveringTo"> & { sellerId: string }
): Promise<Shop> {
  const region = await loadRegion(scope, filters.regionId)
  if (!(await isLive(scope, filters.sellerId))) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "This shop isn't selling in your region")
  }
  const km = await shopDistancesKm(scope, [filters.sellerId], filters.deliveringTo)
  const sellers = await sellerRows(scope, new Map([[filters.sellerId, km.get(filters.sellerId) ?? null]]))
  const seller = sellers.get(filters.sellerId)
  const country = seller?.address?.country_code?.toLowerCase()
  if (!seller || !country || !region.countries.includes(country)) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "This shop isn't selling in your region")
  }
  return { ...toListingSeller(seller), description: seller.description }
}

/**
 * The pin listings measure from: the signed-in buyer's saved address (ADR 0011), else the phone's
 * location sent as `near` (ADR 0015). An address that isn't the buyer's, or has no pin, is ignored
 * rather than refused so listings still load; so is a malformed `near`. Null without either.
 */
export async function deliveringToPin(
  scope: MedusaContainer,
  { customerId, addressId, near }: { customerId: string | null | undefined; addressId: string | undefined; near?: string }
): Promise<Pin | null> {
  return (await savedAddressPin(scope, customerId, addressId)) ?? nearPin(near)
}

async function savedAddressPin(scope: MedusaContainer, customerId: string | null | undefined, addressId: string | undefined) {
  if (!customerId || !addressId) return null
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "customer_address",
    fields: ["id", "metadata"],
    filters: { id: addressId, customer_id: customerId },
  })
  return pinOf(data[0] as unknown as { metadata?: Record<string, unknown> | null } | undefined)
}

/** Two decimal places is a grid of about 1.1 km. */
const toCentiDegrees = (degrees: number) => Math.round(degrees * 100) / 100

/**
 * The phone's location sent as `near` ("lat,lng"), snapped to the centre of its grid cell, so
 * every point in a cell measures alike and a searcher can't walk a distance boundary (ADR 0015).
 */
function nearPin(near: string | undefined): Pin | null {
  if (!near) return null
  const [latitude, longitude] = near.split(",").map(Number)
  return { latitude: toCentiDegrees(latitude), longitude: toCentiDegrees(longitude) }
}
