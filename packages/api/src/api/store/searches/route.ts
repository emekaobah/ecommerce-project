import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { recordSearch } from "../../../lib/popular-searches"
import type { StoreRecordSearchType } from "./validators"

/** `recorded` is false for a region that doesn't exist. */
export type StoreRecordSearchResponse = { recorded: boolean }

/**
 * Records a search the buyer used, for popular searches (#124): the app calls it when a search is
 * submitted or a product is opened from its results, never per keystroke. Guests and buyers alike,
 * and never with who they are.
 */
export const POST = async (req: MedusaStoreRequest<StoreRecordSearchType>, res: MedusaResponse<StoreRecordSearchResponse>) => {
  const { term, region_id, phone_id } = req.validatedBody
  res.json({ recorded: await recordSearch(req.scope, { term, region_id, phone_id }) })
}
