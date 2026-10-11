import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { StoreReviewResponse } from "@mercurjs/types"
import { validateCustomerReview } from "@mercurjs/core/api/store/reviews/helpers"
import type { StoreUpdateReviewType } from "@mercurjs/core/api/store/reviews/validators"
import { updateReviewWorkflow } from "@mercurjs/core/workflows"

// Mercur's own, re-exported so the typed route map (codegen reads this file for the path) still has them.
export { GET, DELETE } from "@mercurjs/core/api/store/reviews/[id]/route"

/**
 * Replaces Mercur's `POST /store/reviews/:id` (Mercur's auth and body validation still apply).
 * An edited review is moderated again before other buyers see it (#7): Mercur's handler kept
 * its status, so a published review could be rewritten unchecked.
 */
export const POST = async (req: AuthenticatedMedusaRequest<StoreUpdateReviewType>, res: MedusaResponse<StoreReviewResponse>) => {
  const { id } = req.params
  await validateCustomerReview(req.scope, req.auth_context.actor_id, id)
  await updateReviewWorkflow(req.scope).run({ input: { id, ...req.validatedBody, status: "pending" } })
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [review] } = await query.graph({ entity: "review", fields: req.queryConfig.fields, filters: { id } })
  res.json({ review: review as unknown as StoreReviewResponse["review"] })
}
