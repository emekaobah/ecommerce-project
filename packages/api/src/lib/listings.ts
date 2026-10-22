import type { ComputeActionContext, MedusaContainer } from "@medusajs/framework/types"
import {
  ApplicationMethodTargetType,
  ComputedActions,
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { wrapOffersWithCalculatedPrices } from "@mercurjs/core/api/store/offers/helpers"
import { ProductStatus } from "@mercurjs/types"
import { distanceBand, distanceKm, pinOf, roundedDistanceKm, type Pin, type ShopDeal } from "@oja/domain"
import { attributionOf, type Attribution } from "./enrichment"
import { perishableProductIds } from "./perishable"
import { liveSellerIds } from "./onboarding"
import { shopStatusesOf, type ShopStatusView } from "./shop-hours"

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

/** The shop a listing belongs to, with what its header shows wherever it appears. */
export type ListingSeller = {
  id: string
  name: string
  handle: string
  /** The logo and banner the shop uploads in the vendor web panel; null when it hasn't, and screens show its initials. */
  logo: string | null
  banner: string | null
  /** Where the shop is: its pickup address's LGA or city (ADR 0002). */
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
}

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
  /** Only these products (a buyer's wishlist). */
  productIds?: string[]
  excludeProductId?: string
  /** The pin of the buyer's delivery address, which listings rank nearest first from (ADR 0011). */
  deliveringTo?: Pin | null
}

type Region = { id: string; currency_code: string; countries: string[] }
type SellerRow = Omit<Shop, "area" | "shop_status" | "distance_km"> & {
  address?: { country_code: string | null; city: string | null; metadata?: Record<string, unknown> | null } | null
  shop_status: ShopStatusView
  /**
   * Straight-line kilometres from the buyer's delivery address to the shop's pickup pin, unrounded
   * for ranking (buyers see `distance_km`, rounded); null without either.
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
  leadtime_to_ship: number | null
  product_variant?: { id: string; title: string | null; price_set?: { id: string } | null } | null
}
type PricedOfferRow = OfferRow & { calculated_price: CalculatedOfferPrice }
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
 * Live shops (open and through onboarding) based in one of the region's countries, with whether
 * they are open now and how far they are from `from`. Their pickup pins stay in here (ADR 0002).
 */
async function sellersServing(scope: MedusaContainer, region: Region, sellerId?: string, from?: Pin | null) {
  const visible = await liveSellerIds(scope)
  const ids = sellerId ? visible.filter((id) => id === sellerId) : visible
  if (!ids.length) return new Map<string, SellerRow>()
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
      "address.metadata",
    ],
    filters: { id: ids },
  })
  const serving = (data as unknown as Omit<SellerRow, "shop_status" | "exact_km">[]).filter((s) => {
    const country = s.address?.country_code?.toLowerCase()
    return !!country && region.countries.includes(country)
  })
  // Closed shops stay listed, marked closed (ADR 0004).
  const statuses = await shopStatusesOf(scope, serving.map((s) => s.id))
  return new Map(
    serving.map((s) => {
      const pickup = pinOf(s.address)
      const exact_km = from && pickup ? distanceKm(from, pickup) : null
      return [s.id, { ...s, shop_status: statuses.get(s.id)!, exact_km }]
    })
  )
}

/** Published products in the publishable key's sales channels, with their titles for ranking. */
async function listableProducts(scope: MedusaContainer, filters: ListingFilters): Promise<Map<string, string>> {
  if (!filters.salesChannelIds.length) return new Map()
  const productIds = filters.productId ? [filters.productId] : filters.productIds
  if (productIds && !productIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: inChannels } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id"],
    filters: {
      sales_channel_id: filters.salesChannelIds,
      ...(productIds ? { product_id: productIds } : {}),
    },
  })
  const channelProductIds = [...new Set((inChannels as { product_id: string }[]).map((l) => l.product_id))]
  if (!channelProductIds.length) return new Map()
  const categoryIds = filters.categoryId ? await categoryTree(scope, filters.categoryId) : undefined
  if (categoryIds && !categoryIds.length) return new Map()
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title"],
    // The generated filter type leaves out the product module's own relations, which filter fine.
    filters: {
      status: ProductStatus.PUBLISHED,
      id: channelProductIds,
      ...titleFilter(filters.search),
      ...(categoryIds ? { categories: { id: categoryIds } } : {}),
    } as any,
  })
  return new Map(
    (data as { id: string; title: string }[]).filter((p) => p.id !== filters.excludeProductId).map((p) => [p.id, p.title])
  )
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

/** Every word of the search in the product's title, ignoring case; no filter for an empty search. */
function titleFilter(search: string | undefined) {
  const words = searchWords(search)
  if (!words.length) return {}
  // `%`, `_` and `\` are pattern characters in ILIKE; a buyer's query matches them literally.
  const escape = (word: string) => word.replaceAll(/[\\%_]/g, (c) => `\\${c}`)
  return { $and: words.map((word) => ({ title: { $ilike: `%${escape(word)}%` } })) }
}

const searchWords = (search: string | undefined) => search?.toLowerCase().split(/\s+/).filter(Boolean) ?? []

/**
 * Offers visible in the region, each priced by Mercur's per-offer pricing (the variant's
 * price set scoped by the offer). An offer without a price in the region's currency is left out.
 */
async function pricedOffers(scope: MedusaContainer, region: Region, filters: ListingFilters) {
  const sellers = await sellersServing(scope, region, filters.sellerId, filters.deliveringTo)
  const titles = sellers.size ? await listableProducts(scope, filters) : new Map<string, string>()
  if (!titles.size) return { sellers, titles, offers: [] as PricedOfferRow[] }

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
    filters: { seller_id: [...sellers.keys()], product_id: [...titles.keys()] },
    pagination: { order: { created_at: "ASC", id: "ASC" } },
  })
  return { sellers, titles, offers: await priceOffers(scope, region, data as OfferRow[]) }
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

type ListingGroup = { seller: SellerRow; productId: string; title: string; offers: PricedOfferRow[] }

/** Groups offers into one listing per shop and product, in the order they were first listed. */
function groupListings(
  sellers: Map<string, SellerRow>,
  titles: Map<string, string>,
  offers: PricedOfferRow[]
): ListingGroup[] {
  const listings = new Map<string, ListingGroup>()
  for (const offer of offers) {
    const key = `${offer.seller_id}:${offer.product_id}`
    const listing = listings.get(key)
    if (listing) listing.offers.push(offer)
    else
      listings.set(key, {
        seller: sellers.get(offer.seller_id)!,
        productId: offer.product_id,
        title: titles.get(offer.product_id)!,
        offers: [offer],
      })
  }
  return [...listings.values()]
}

/** Days until the shop ships: the slowest of its offers, else the shop's default; null when neither is set. */
function leadtimeToShip({ seller, offers }: Pick<ListingGroup, "seller" | "offers">): number | null {
  const leadTimes = offers
    .map((o) => o.leadtime_to_ship ?? seller.default_leadtime_to_ship)
    .filter((days): days is number => days != null)
  return leadTimes.length ? Math.max(...leadTimes) : null
}

/**
 * How well a product's name matches the search: the whole name (3), the start of it (2),
 * the start of a word for every search word (1), or only somewhere inside (0).
 */
function relevance(title: string, words: string[]): number {
  if (!words.length) return 0
  const name = title.toLowerCase()
  const phrase = words.join(" ")
  if (name === phrase) return 3
  if (name.startsWith(phrase)) return 2
  const nameWords = name.split(/[^\p{L}\p{N}]+/u)
  return words.every((word) => nameWords.some((w) => w.startsWith(word))) ? 1 : 0
}

/**
 * The documented listing order (docs/design.md, ADR 0011): best name match first, then the
 * nearest distance band, then the shop that ships soonest, then the nearest shop, then the
 * order listings were first made. Never by price. Without a delivery address every shop is
 * equally far, so the order is name match, ship time, first listed; a shop without a pin
 * comes after those with one.
 */
function orderListings(groups: ListingGroup[], search: string | undefined) {
  const words = searchWords(search)
  const ranked = groups.map((group, index) => {
    const km = group.seller.exact_km ?? Number.POSITIVE_INFINITY
    return {
      group,
      index,
      relevance: relevance(group.title, words),
      band: distanceBand(km),
      days: leadtimeToShip(group) ?? Number.POSITIVE_INFINITY,
      km,
    }
  })
  // Two unknowns (Infinity - Infinity) compare as NaN, which is falsy: a tie.
  ranked.sort(
    (a, b) => b.relevance - a.relevance || a.band - b.band || a.days - b.days || a.km - b.km || a.index - b.index
  )
  return ranked.map((r) => r.group)
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
    distance_km: seller.exact_km == null ? null : roundedDistanceKm(seller.exact_km),
  }
}

function toListing<P extends ListingProduct>(
  group: Pick<ListingGroup, "seller" | "offers">,
  product: P,
  deals: ListingDeal[]
): Listing<P> {
  const { seller, offers } = group
  return {
    seller: toListingSeller(seller),
    product,
    offers: offers.map(({ id, variant_id, product_variant, calculated_price }) => ({
      id,
      variant_id,
      variant_title: product_variant?.title ?? null,
      calculated_price: {
        calculated_amount: Number(calculated_price.calculated_amount),
        original_amount: Number(calculated_price.original_amount ?? calculated_price.calculated_amount),
        currency_code: calculated_price.currency_code,
      },
    })),
    leadtime_to_ship: leadtimeToShip(group),
    deals,
  }
}

type AutomaticPromotion = {
  id: string
  code: string
  type: string
  seller?: { id: string } | null
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

const dealKey = (sellerId: string, productId: string) => `${sellerId}:${productId}`

/**
 * Each listing's deals, by `dealKey`: its shop's running automatic promotions that would take
 * something off one of the product's offers in a cart of its own. A promotion that depends on
 * the buyer (a customer group) or on the rest of the cart gets no badge.
 */
async function dealsOf(
  scope: MedusaContainer,
  region: Region,
  filters: Pick<ListingFilters, "salesChannelIds">,
  groups: Pick<ListingGroup, "seller" | "productId" | "offers">[]
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
      (!p.application_method.currency_code || p.application_method.currency_code === region.currency_code)
  )
  const withDeals = groups.filter((g) => promotions.some((p) => p.seller!.id === g.seller.id))
  if (!withDeals.length) return deals

  const { data: productRows } = await query.graph({
    entity: "product",
    fields: ["id", "collection_id", "type_id", "categories.id", "tags.id"],
    filters: { id: [...new Set(withDeals.map((g) => g.productId))] },
  })
  const products = new Map((productRows as unknown as DealProduct[]).map((p) => [p.id, p]))
  const promotionModule = scope.resolve(Modules.PROMOTION)
  await Promise.all(
    withDeals.map(async (group) => {
      const product = products.get(group.productId)
      if (!product) return
      const context = {
        currency_code: region.currency_code,
        region_id: region.id,
        region: { id: region.id },
        sales_channel_id: filters.salesChannelIds[0],
        shipping_address: { country_code: region.countries[0] },
        items: group.offers.map((offer) => {
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
        }),
        shipping_methods: [],
      }
      const actions = await promotionModule.computeActions([], context as unknown as ComputeActionContext)
      const applied = new Set(actions.filter((a) => a.action === ComputedActions.ADD_ITEM_ADJUSTMENT).map((a) => a.code))
      const own = promotions.filter((p) => p.seller!.id === group.seller.id && applied.has(p.code))
      deals.set(
        dealKey(group.seller.id, group.productId),
        own.map((p) => ({
          promotion_id: p.id,
          type: p.application_method!.type,
          value: Number(p.application_method!.value),
          allocation: p.application_method!.allocation,
          currency_code: p.application_method!.currency_code ?? region.currency_code,
        }))
      )
    })
  )
  return deals
}

/**
 * Listings visible in a region, one per shop and product, in the documented order. Offers are
 * grouped and ordered before paging, so a page never splits a listing; fine at v1 catalogue sizes.
 */
export async function listListings(
  scope: MedusaContainer,
  filters: ListingFilters,
  page: { limit: number; offset: number }
): Promise<{ listings: Listing[]; count: number }> {
  const region = await loadRegion(scope, filters.regionId)
  const { sellers, titles, offers } = await pricedOffers(scope, region, filters)
  const groups = orderListings(groupListings(sellers, titles, offers), filters.search)
  const pageGroups = groups.slice(page.offset, page.offset + page.limit)
  if (!pageGroups.length) return { listings: [], count: groups.length }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "thumbnail"],
    filters: { id: [...new Set(pageGroups.map((g) => g.productId))] },
  })
  const products = new Map((data as ListingProduct[]).map((p) => [p.id, p]))
  const deals = await dealsOf(scope, region, filters, pageGroups)
  return {
    listings: pageGroups.map((g) =>
      toListing(g, products.get(g.productId)!, deals.get(dealKey(g.seller.id, g.productId)) ?? [])
    ),
    count: groups.length,
  }
}

/** One shop's listing of one product, with the product's details, or not found. */
export async function retrieveListing(
  scope: MedusaContainer,
  filters: ListingFilters & { sellerId: string; productId: string }
): Promise<Listing<ListingProductDetail>> {
  const region = await loadRegion(scope, filters.regionId)
  const { sellers, titles, offers } = await pricedOffers(scope, region, filters)
  const [group] = groupListings(sellers, titles, offers)
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
  const seller = (await sellersServing(scope, region, filters.sellerId, filters.deliveringTo)).get(filters.sellerId)
  if (!seller) throw new MedusaError(MedusaError.Types.NOT_FOUND, "This shop isn't selling in your region")
  return { ...toListingSeller(seller), description: seller.description }
}

/**
 * The pin of the signed-in buyer's saved address that listings measure from (ADR 0011). Null
 * for a guest, without an address, or for an address that isn't the buyer's, which is ignored
 * rather than refused so listings still load.
 */
export async function deliveringToPin(
  scope: MedusaContainer,
  { customerId, addressId }: { customerId: string | null | undefined; addressId: string | undefined }
): Promise<Pin | null> {
  if (!customerId || !addressId) return null
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "customer_address",
    fields: ["id", "metadata"],
    filters: { id: addressId, customer_id: customerId },
  })
  return pinOf(data[0] as unknown as { metadata?: Record<string, unknown> | null } | undefined)
}
