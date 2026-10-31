import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POPULAR_SEARCH_MODULE, type PopularSearchModuleService } from "../modules/popular-search"
import {
  forgetSearchesWorkflow,
  publishPopularSearchesWorkflow,
  recordSearchWorkflow,
} from "../workflows/popular-search/workflows"
import { countListings } from "./listings"
import { BLOCKED_SEARCH_WORDS } from "./search-blocklist"

// Popular searches on the Search tab (#124), Oja-wide in each region for now rather than near
// the buyer. The app records a search only when it's used (submitted, or a product opened from
// its results), never on a keystroke, with an anonymous id the phone made for itself. Every hour
// the job counts the last 14 days' searches by how many phones made them and publishes the top
// few that are not blocklisted and still find listings.

type Scope = Pick<MedusaContainer, "resolve">

const DAY = 24 * 60 * 60 * 1000
/** How far back a search counts towards the list. */
export const POPULAR_WINDOW_DAYS = 14
/** How long a recorded search is kept. */
export const SEARCH_RETENTION_DAYS = 90
/** How many different phones must have made a search for it to be popular: one person can't make it so. */
export const POPULAR_MIN_PHONES = 5
/** How many popular searches the Search tab shows. */
export const POPULAR_SEARCHES_SHOWN = 8
/** The longest term recorded; longer ones are cut, not refused. */
export const SEARCH_TERM_MAX = 100

/** A search as it's recorded and counted: lower-case, trimmed, its spaces collapsed. */
export const normaliseSearch = (term: string) => term.trim().replaceAll(/\s+/g, " ").toLowerCase().slice(0, SEARCH_TERM_MAX).trim()

/** Whether any word of a normalised term is on the blocklist. */
export const isBlockedSearch = (term: string) => term.split(" ").some((word) => BLOCKED_SEARCH_WORDS.has(word))

/** Records a search a buyer used, normalised; without who they are. */
export async function recordSearch(
  scope: Scope,
  search: { term: string; region_id: string; phone_id: string },
  now = new Date()
): Promise<void> {
  await recordSearchWorkflow(scope as MedusaContainer).run({
    input: { ...search, term: normaliseSearch(search.term), searched_at: now },
  })
}

/** The region's popular searches, as last published, most popular first; none before the first run. */
export async function popularSearchesOf(scope: Scope, regionId: string): Promise<string[]> {
  const popular = await scope
    .resolve<PopularSearchModuleService>(POPULAR_SEARCH_MODULE)
    .listPopularSearches({ region_id: regionId }, { select: ["term", "rank"], order: { rank: "ASC" } })
  return popular.map((p) => p.term)
}

type Candidate = { region_id: string; term: string }

/**
 * Each region's terms searched from at least `minPhones` phones since `since`, most phones first,
 * then most searches, then alphabetically. Counted in SQL (ADR 0014).
 */
async function candidatesSince(scope: Scope, since: Date, minPhones: number): Promise<Candidate[]> {
  const knex = scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION)
  return (await knex("search_record")
    .whereNull("deleted_at")
    .where("searched_at", ">=", since)
    .groupBy("region_id", "term")
    .havingRaw("count(DISTINCT phone_id) >= ?", [minPhones])
    .select("region_id", "term")
    .orderByRaw("count(DISTINCT phone_id) DESC, count(*) DESC, term ASC")) as unknown as Candidate[]
}

/** The regions with a published list, which a run with no candidates for them empties. */
async function publishedRegions(scope: Scope): Promise<string[]> {
  const popular = await scope.resolve<PopularSearchModuleService>(POPULAR_SEARCH_MODULE).listPopularSearches({}, { select: ["region_id"] })
  return popular.map((p) => p.region_id)
}

/**
 * What the hourly job does: deletes searches past the retention period, then publishes each
 * region's popular searches afresh. A term is left out when it's blocklisted or no longer finds
 * a listing in the region; a region that doesn't exist gets an empty list.
 */
export async function publishPopularSearches(
  scope: Scope,
  { now = new Date(), minPhones = POPULAR_MIN_PHONES }: { now?: Date; minPhones?: number } = {}
): Promise<void> {
  await forgetSearchesWorkflow(scope as MedusaContainer).run({
    input: { before: new Date(now.getTime() - SEARCH_RETENTION_DAYS * DAY) },
  })

  const candidates = await candidatesSince(scope, new Date(now.getTime() - POPULAR_WINDOW_DAYS * DAY), minPhones)
  const regionIds = [...new Set([...candidates.map((c) => c.region_id), ...(await publishedRegions(scope))])]
  const regions = new Set(
    (await scope.resolve(Modules.REGION).listRegions({ id: regionIds }, { select: ["id"] })).map((r) => r.id)
  )
  // The listings a buyer could find: those in any sales channel that is on.
  const salesChannelIds = (
    await scope.resolve(Modules.SALES_CHANNEL).listSalesChannels({ is_disabled: false }, { select: ["id"] })
  ).map((c) => c.id)

  for (const regionId of regionIds) {
    const terms: string[] = []
    if (regions.has(regionId)) {
      for (const { term } of candidates.filter((c) => c.region_id === regionId)) {
        if (terms.length === POPULAR_SEARCHES_SHOWN) break
        if (isBlockedSearch(term)) continue
        const found = await countListings(scope as MedusaContainer, { regionId, salesChannelIds, search: term })
        if (found) terms.push(term)
      }
    }
    await publishPopularSearchesWorkflow(scope as MedusaContainer).run({ input: { region_id: regionId, terms } })
  }
}
