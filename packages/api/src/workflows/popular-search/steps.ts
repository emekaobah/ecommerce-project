import type { MedusaContainer } from "@medusajs/framework/types"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { POPULAR_SEARCH_MODULE, type PopularSearchModuleService } from "../../modules/popular-search"

export type SearchRecordInput = { term: string; region_id: string; phone_id: string; searched_at: Date }
export type PopularSearchesInput = { region_id: string; terms: string[] }

const popularSearchService = (scope: Pick<MedusaContainer, "resolve">) =>
  scope.resolve<PopularSearchModuleService>(POPULAR_SEARCH_MODULE)

/** Records one search a buyer used. */
export const recordSearchStep = createStep(
  "record-search",
  async (input: SearchRecordInput, { container }) => {
    const created = await popularSearchService(container).createSearchRecords(input)
    return new StepResponse({ term: created.term }, created.id)
  },
  async (id: string | undefined, { container }) => {
    if (id) await popularSearchService(container).deleteSearchRecords(id)
  }
)

/** Replaces the region's popular searches with `terms`, most popular first; undone by putting the old list back. */
export const publishPopularSearchesStep = createStep(
  "publish-popular-searches",
  async (input: PopularSearchesInput, { container }) => {
    const previous = await popularSearchService(container).replacePopularSearches(input.region_id, input.terms)
    return new StepResponse({ terms: input.terms }, { region_id: input.region_id, previous })
  },
  async (compensation: { region_id: string; previous: string[] } | undefined, { container }) => {
    if (compensation) await popularSearchService(container).replacePopularSearches(compensation.region_id, compensation.previous)
  }
)

/** How many expired searches are deleted at a time, so a backlog is never loaded at once. */
const FORGET_BATCH = 1000

/** Deletes the searches recorded before `before`, for good: kept no longer than that. */
export const forgetSearchesStep = createStep("forget-searches", async (input: { before: Date }, { container }) => {
  const service = popularSearchService(container)
  let forgotten = 0
  let batch: { id: string }[]
  do {
    batch = await service.listSearchRecords({ searched_at: { $lt: input.before } }, { select: ["id"], take: FORGET_BATCH })
    if (batch.length) await service.deleteSearchRecords(batch.map((r) => r.id))
    forgotten += batch.length
  } while (batch.length === FORGET_BATCH)
  return new StepResponse({ forgotten })
})
