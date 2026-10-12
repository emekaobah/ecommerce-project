import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { StoreReviewListResponse, StoreReviewResponse } from "@mercurjs/types"
import type { StoreCreateReviewType, StoreGetReviewsParamsType } from "@mercurjs/core/api/store/reviews/validators"
import { authorReviews } from "../../../lib/reviews"
import { submitReviewWorkflow } from "../../../workflows/review/submit-review"

// Replaces both of Mercur's handlers on this path; Mercur's auth, validation and the filter to
// the signed-in buyer's own reviews still apply.

/**
 * The reviews the signed-in buyer wrote. Unlike Mercur's, the shop's reply shows only once a
 * review is published (#7), as other buyers see it.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest<unknown, StoreGetReviewsParamsType>,
  res: MedusaResponse<StoreReviewListResponse>
) => {
  const { reviews, metadata } = await authorReviews(req.scope, {
    fields: req.queryConfig.fields,
    filters: req.filterableFields,
    pagination: req.queryConfig.pagination,
  })
  res.json({ reviews, count: metadata?.count ?? 0, offset: metadata?.skip ?? 0, limit: metadata?.take ?? 0 })
}

/**
 * A buyer reviews a shop or a product only once they received the order that brought it (#7);
 * the review waits for moderation.
 */
export const POST = async (req: AuthenticatedMedusaRequest<StoreCreateReviewType>, res: MedusaResponse<StoreReviewResponse>) => {
  const { result } = await submitReviewWorkflow(req.scope).run({
    input: { ...req.validatedBody, customer_id: req.auth_context.actor_id },
  })
  const { reviews: [review] } = await authorReviews(req.scope, { fields: req.queryConfig.fields, filters: { id: result.id } })
  res.status(201).json({ review })
}
