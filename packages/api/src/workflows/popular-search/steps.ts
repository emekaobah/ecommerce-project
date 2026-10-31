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

/** Replaces the region's popular searches with `terms`, most popular first. */
export const publishPopularSearchesStep = createStep(
  "publish-popular-searches",
  async (input: PopularSearchesInput, { container }) => {
    const service = popularSearchService(container)
    const previous = await service.listPopularSearches({ region_id: input.region_id }, { order: { rank: "ASC" } })
    if (previous.length) await service.deletePopularSearches(previous.map((p) => p.id))
    const created = input.terms.length
      ? await service.createPopularSearches(input.terms.map((term, rank) => ({ region_id: input.region_id, term, rank })))
      : []
    return new StepResponse(
      { terms: input.terms },
      { created: created.map((c) => c.id), previous: previous.map(({ region_id, term, rank }) => ({ region_id, term, rank })) }
    )
  },
  async (
    compensation: { created: string[]; previous: { region_id: string; term: string; rank: number }[] } | undefined,
    { container }
  ) => {
    if (!compensation) return
    const service = popularSearchService(container)
    if (compensation.created.length) await service.deletePopularSearches(compensation.created)
    if (compensation.previous.length) await service.createPopularSearches(compensation.previous)
  }
)

/** Deletes the searches recorded before `before`, for good: kept no longer than that. */
export const forgetSearchesStep = createStep("forget-searches", async (input: { before: Date }, { container }) => {
  const service = popularSearchService(container)
  const old = await service.listSearchRecords({ searched_at: { $lt: input.before } }, { select: ["id"] })
  if (old.length) await service.deleteSearchRecords(old.map((r) => r.id))
  return new StepResponse({ forgotten: old.length })
})
