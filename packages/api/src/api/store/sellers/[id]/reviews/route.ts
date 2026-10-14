import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { isLive } from "../../../../../lib/onboarding"
import { publishedReviews, type PublishedReviews } from "../../../../../lib/reviews"
import type { StoreGetPublishedReviewsType } from "../../../reviews/validators"

/**
 * A shop's published reviews, newest first, with its rating: their average and count (#7).
 * Not found for a shop that isn't live (ADR 0007).
 */
export const GET = async (
  req: MedusaRequest<unknown, StoreGetPublishedReviewsType>,
  res: MedusaResponse<PublishedReviews & { limit: number; offset: number }>
) => {
  const { id } = req.params
  if (!(await isLive(req.scope, id))) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Seller with id ${id} was not found`)
  const { limit, offset } = req.validatedQuery
  res.json({ ...(await publishedReviews(req.scope, { reference: "seller", reference_id: id }, { limit, offset })), offset, limit })
}
