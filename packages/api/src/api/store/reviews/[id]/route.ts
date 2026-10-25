import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { validateCustomerReview } from "@mercurjs/core/api/store/reviews/helpers"
import type { StoreUpdateReviewType } from "@mercurjs/core/api/store/reviews/validators"
import { updateReviewWorkflow } from "@mercurjs/core/workflows"
import { authorReviews, type AuthorReview } from "../../../../lib/reviews"

// Mercur's own, re-exported so the typed route map (codegen reads this file for the path) still has it.
export { DELETE } from "@mercurjs/core/api/store/reviews/[id]/route"

// Replaces Mercur's GET and POST on this path; Mercur's auth and validation still apply.

/**
 * One of the buyer's own reviews; the shop's reply shows only once it is published (#7), and
 * `fields=+shop.name` names the shop it was bought from (#96).
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<{ review: AuthorReview }>) => {
  const { id } = req.params
  await validateCustomerReview(req.scope, req.auth_context.actor_id, id)
  const { reviews: [review] } = await authorReviews(req.scope, { fields: req.queryConfig.fields, filters: { id } })
  res.json({ review })
}

/**
 * An edited review is moderated again before other buyers see it (#7): Mercur's handler kept
 * its status, so a published review could be rewritten unchecked.
 */
export const POST = async (req: AuthenticatedMedusaRequest<StoreUpdateReviewType>, res: MedusaResponse<{ review: AuthorReview }>) => {
  const { id } = req.params
  await validateCustomerReview(req.scope, req.auth_context.actor_id, id)
  await updateReviewWorkflow(req.scope).run({ input: { id, ...req.validatedBody, status: "pending" } })
  const { reviews: [review] } = await authorReviews(req.scope, { fields: req.queryConfig.fields, filters: { id } })
  res.json({ review })
}
