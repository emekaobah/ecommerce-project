import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ProductStatus } from "@mercurjs/types"
import { DISTANCE_BANDS_KM, type Pin } from "@oja/domain"
import { escapeLike, haversineKmSql, LIKE_ESCAPE } from "./sql"

// Listings filtered, ranked and paged in Postgres (ADR 0014), in the order ADR 0011 sets: best
// name match, nearest distance band, the shop that ships soonest, the nearest shop, then the
// order listings were first made; never by price. A listing is one shop's offers of one product.
//
// `rankedListings` is the query every ranked route builds on: one row per listing, with the
// columns it ranks by. `LISTING_ORDER` orders it; a route that ranks shops instead groups it.

/** What a listing must match to be ranked. Every list is a whitelist: empty means nothing matches. */
export type RankingFilters = {
  /** Live shops (`liveSellerIds`); those based outside the region's countries are left out here. */
  sellerIds: string[]
  /** The region's countries, lower-case ISO 2. */
  countries: string[]
  regionId: string
  currencyCode: string
  /** The publishable key's sales channels; products outside them are never listed. */
  salesChannelIds: string[]
  /** Lower-case words the product's name must all hold. */
  words: string[]
  /** Products in any of these categories. */
  categoryIds?: string[]
  productIds?: string[]
  excludeProductId?: string
  /** Only these listings, by shop and product (a buyer's wishlist). */
  pairs?: { seller_id: string; product_id: string }[]
  /** The pin of the buyer's delivery address, which listings rank nearest first from; none ranks without distance. */
  from?: Pin | null
}

/** A ranked listing: which shop and product, and what it ranked by. */
export type RankedListing = {
  seller_id: string
  product_id: string
  /** Days until the shop ships: the slowest of its offers, else the shop's default; null when neither is set. */
  leadtime_to_ship: number | null
  /** Straight-line kilometres from `from` to the shop's pickup pin, unrounded; null without either. */
  exact_km: number | null
}

/** A distance's band in SQL, nearest first as `distanceBand` numbers them; NULL (ranked last) without a distance. */
function bandOf(km: string) {
  const bands = DISTANCE_BANDS_KM.map((limit, band) => `WHEN ${km} < ${limit} THEN ${band}`).join(" ")
  return `CASE WHEN ${km} IS NULL THEN NULL ${bands} ELSE ${DISTANCE_BANDS_KM.length} END`
}

const escapeRegex = (word: string) => word.replaceAll(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)

/**
 * How well the product's name matches the words, as the feed has always ranked it: the whole
 * name (3), the start of it (2), the start of a word for every word (1), or only inside (0).
 */
function relevanceOf(knex: Knex, words: string[]) {
  if (!words.length) return knex.raw("0")
  const phrase = words.join(" ")
  const wordStarts = words.map(() => `lower(p.title) ~ ('(^|[^[:alnum:]])' || ?)`).join(" AND ")
  return knex.raw(
    `CASE WHEN lower(p.title) = ? THEN 3 WHEN starts_with(lower(p.title), ?) THEN 2 WHEN ${wordStarts} THEN 1 ELSE 0 END`,
    [phrase, phrase, ...words.map(escapeRegex)]
  )
}

/**
 * Offers buyers can see, grouped into one row per listing with what it ranks by: `relevance`,
 * `band`, `leadtime_to_ship`, `exact_km`, `first_listed_at` and `first_offer_id`. An offer counts
 * only when its variant has a price in the region's currency that applies to it (its own offer
 * price, or one for every offer of the variant), as Mercur's per-offer pricing would find.
 */
export function rankedListings(knex: Knex, filters: RankingFilters): Knex.QueryBuilder {
  const km = haversineKmSql(filters.from)
  const query = knex("offer as o")
    .join("seller as s", "s.id", "o.seller_id")
    .join("seller_address as sa", function () {
      this.on("sa.seller_id", "s.id").andOnNull("sa.deleted_at")
    })
    .join("product as p", "p.id", "o.product_id")
    .join("product_variant as v", "v.id", "o.variant_id")
    .leftJoin("shop_pin as sp", function () {
      this.on("sp.seller_id", "o.seller_id").andOnNull("sp.deleted_at")
    })
    .whereNull("o.deleted_at")
    .whereNull("s.deleted_at")
    .whereNull("p.deleted_at")
    .whereNull("v.deleted_at")
    .where("p.status", ProductStatus.PUBLISHED)
    .whereRaw("o.seller_id = ANY(?)", [filters.sellerIds])
    .whereRaw("lower(sa.country_code) = ANY(?)", [filters.countries])
    .whereExists(function () {
      this.select(knex.raw("1"))
        .from("product_sales_channel as psc")
        .whereRaw("psc.product_id = p.id")
        .whereNull("psc.deleted_at")
        .whereRaw("psc.sales_channel_id = ANY(?)", [filters.salesChannelIds])
    })
    .whereExists(function () {
      this.select(knex.raw("1"))
        .from("product_variant_price_set as vps")
        .join("price as pr", "pr.price_set_id", "vps.price_set_id")
        .whereRaw("vps.variant_id = o.variant_id")
        .whereNull("vps.deleted_at")
        .whereNull("pr.deleted_at")
        .whereNull("pr.price_list_id")
        .where("pr.currency_code", filters.currencyCode)
        .whereNotExists(function () {
          this.select(knex.raw("1"))
            .from("price_rule as r")
            .whereRaw("r.price_id = pr.id")
            .whereNull("r.deleted_at")
            .whereRaw("NOT ((r.attribute = 'offer_id' AND r.value = o.id) OR (r.attribute = 'region_id' AND r.value = ?))", [
              filters.regionId,
            ])
        })
    })

  for (const word of filters.words) query.whereRaw(`p.title ILIKE ? ESCAPE ${LIKE_ESCAPE}`, [`%${escapeLike(word)}%`])
  if (filters.categoryIds) {
    const categoryIds = filters.categoryIds
    query.whereExists(function () {
      this.select(knex.raw("1"))
        .from("product_category_product as pcp")
        .whereRaw("pcp.product_id = p.id")
        .whereRaw("pcp.product_category_id = ANY(?)", [categoryIds])
    })
  }
  if (filters.productIds) query.whereRaw("o.product_id = ANY(?)", [filters.productIds])
  if (filters.excludeProductId) query.whereNot("o.product_id", filters.excludeProductId)
  if (filters.pairs) {
    query.whereIn(
      ["o.seller_id", "o.product_id"],
      filters.pairs.map((p) => [p.seller_id, p.product_id])
    )
  }

  return query
    .groupBy("o.seller_id", "o.product_id", "p.title", "sp.latitude", "sp.longitude")
    .select(
      "o.seller_id",
      "o.product_id",
      knex.raw("? AS relevance", [relevanceOf(knex, filters.words)]),
      knex.raw("max(coalesce(o.leadtime_to_ship, s.default_leadtime_to_ship)) AS leadtime_to_ship"),
      knex.raw(`${km} AS exact_km`),
      knex.raw(`${bandOf(km)} AS band`),
      knex.raw("min(o.created_at) AS first_listed_at"),
      knex.raw("min(o.id) AS first_offer_id")
    )
}

/** The documented listing order over `rankedListings`, total so pages never overlap or skip. */
export const LISTING_ORDER = [
  { column: "relevance", order: "desc" },
  { column: "band", order: "asc", nulls: "last" },
  { column: "leadtime_to_ship", order: "asc", nulls: "last" },
  { column: "exact_km", order: "asc", nulls: "last" },
  { column: "first_listed_at", order: "asc" },
  { column: "first_offer_id", order: "asc" },
] as const

type RankedRow = { seller_id: string; product_id: string; leadtime_to_ship: number | string | null; exact_km: number | string | null }

/** A page of listings in the documented order, and how many listings, and shops, match in all. */
export async function rankListingPage(
  scope: MedusaContainer,
  filters: RankingFilters,
  page: { limit: number; offset: number }
): Promise<{ listings: RankedListing[]; count: number; shopCount: number }> {
  if (!filters.sellerIds.length || !filters.salesChannelIds.length || filters.pairs?.length === 0) {
    return { listings: [], count: 0, shopCount: 0 }
  }
  const knex = scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION)
  const ranked = () => knex.from(rankedListings(knex, filters).as("l"))
  const [[total], rows] = await Promise.all([
    ranked().select(knex.raw("count(*) AS count, count(DISTINCT seller_id) AS shop_count")) as unknown as Promise<
      { count: number | string; shop_count: number | string }[]
    >,
    ranked()
      .select("seller_id", "product_id", "leadtime_to_ship", "exact_km")
      .orderBy(LISTING_ORDER.map((o) => ({ ...o })))
      .limit(page.limit)
      .offset(page.offset),
  ])
  return {
    count: Number(total?.count ?? 0),
    shopCount: Number(total?.shop_count ?? 0),
    listings: (rows as unknown as RankedRow[]).map(toRankedListing),
  }
}

const toRankedListing = (r: RankedRow): RankedListing => ({
  seller_id: r.seller_id,
  product_id: r.product_id,
  leadtime_to_ship: r.leadtime_to_ship == null ? null : Number(r.leadtime_to_ship),
  exact_km: r.exact_km == null ? null : Number(r.exact_km),
})

/** `LISTING_ORDER` as SQL, for ranking listings within each shop. */
const listingOrderSql = () =>
  LISTING_ORDER.map((o) => `${o.column} ${o.order}${nullsSql(o)}`).join(", ")

/** A ranking column's NULLS clause, as SQL; empty where it keeps Postgres's default. */
const nullsSql = (o: (typeof LISTING_ORDER)[number]) => ("nulls" in o ? ` NULLS ${o.nulls}` : "")

/** A ranked shop, where its first listing comes in the feed, with its top listings in feed order. */
export type RankedShop = {
  seller_id: string
  /** How many of the shop's listings match. */
  listing_count: number
  /** Straight-line kilometres from `from` to the shop's pickup pin, unrounded; null without either. */
  exact_km: number | null
  listings: RankedListing[]
}

type ShopRow = { seller_id: string; listing_count: number | string; exact_km: number | string | null }

/**
 * A page of shops in the order their first listings come in the feed, each with its first
 * `perShop` listings, and how many shops match in all. A shop is one row of the ranking, so
 * pages never repeat or skip one.
 */
export async function rankShopPage(
  scope: MedusaContainer,
  filters: RankingFilters,
  page: { limit: number; offset: number },
  perShop: number
): Promise<{ shops: RankedShop[]; count: number }> {
  if (!filters.sellerIds.length || !filters.salesChannelIds.length || filters.pairs?.length === 0) {
    return { shops: [], count: 0 }
  }
  const knex = scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION)
  // Each listing numbered within its shop in feed order, with its shop's listing count.
  const numbered = () =>
    knex.from(
      knex
        .from(rankedListings(knex, filters).as("l"))
        .select(
          "*",
          knex.raw(`row_number() OVER (PARTITION BY seller_id ORDER BY ${listingOrderSql()}) AS shop_rank`),
          knex.raw("count(*) OVER (PARTITION BY seller_id) AS listing_count")
        )
        .as("n")
    )
  const [[total], firsts] = await Promise.all([
    knex.from(rankedListings(knex, filters).as("l")).countDistinct({ count: "seller_id" }),
    numbered()
      .where("shop_rank", 1)
      .select("seller_id", "listing_count", "exact_km")
      .orderBy(LISTING_ORDER.map((o) => ({ ...o })))
      .limit(page.limit)
      .offset(page.offset),
  ])
  const shops = firsts as unknown as ShopRow[]
  const top = shops.length
    ? ((await numbered()
        .whereRaw("seller_id = ANY(?)", [shops.map((s) => s.seller_id)])
        .where("shop_rank", "<=", perShop)
        .select("seller_id", "product_id", "leadtime_to_ship", "exact_km")
        .orderBy(["seller_id", "shop_rank"])) as unknown as RankedRow[])
    : []
  return {
    count: Number(total?.count ?? 0),
    shops: shops.map((s) => ({
      seller_id: s.seller_id,
      listing_count: Number(s.listing_count),
      exact_km: s.exact_km == null ? null : Number(s.exact_km),
      listings: top.filter((r) => r.seller_id === s.seller_id).map(toRankedListing),
    })),
  }
}

/** Straight-line kilometres from `from` to each shop's pickup pin; shops without a pin are left out. */
export async function shopDistancesKm(scope: MedusaContainer, sellerIds: string[], from: Pin | null | undefined) {
  if (!from || !sellerIds.length) return new Map<string, number>()
  const knex = scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION)
  const rows = (await knex("shop_pin as sp")
    .select("sp.seller_id", knex.raw(`${haversineKmSql(from)} AS km`))
    .whereNull("sp.deleted_at")
    .whereRaw("sp.seller_id = ANY(?)", [sellerIds])) as unknown as { seller_id: string; km: number | string }[]
  return new Map(rows.map((r) => [r.seller_id, Number(r.km)]))
}
