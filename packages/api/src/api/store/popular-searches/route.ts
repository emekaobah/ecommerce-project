import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { popularSearchesOf } from "../../../lib/popular-searches"
import type { StoreGetPopularSearchesType } from "./validators"

export type StorePopularSearchesResponse = { popular_searches: string[] }

/** The region's popular searches, most popular first, as the hourly job last published them (#124); empty before then. */
export const GET = async (
  req: MedusaStoreRequest<unknown, StoreGetPopularSearchesType>,
  res: MedusaResponse<StorePopularSearchesResponse>
) => {
  res.json({ popular_searches: await popularSearchesOf(req.scope, req.validatedQuery.region_id) })
}
