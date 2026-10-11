import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { StoreReviewResponse } from "@mercurjs/types"
import type { StoreCreateReviewType } from "@mercurjs/core/api/store/reviews/validators"
import { submitReviewWorkflow } from "../../../workflows/review/submit-review"

// Mercur's own, re-exported so the typed route map (codegen reads this file for the path) has it:
// the reviews the signed-in buyer wrote.
export { GET } from "@mercurjs/core/api/store/reviews/route"

/**
 * Replaces Mercur's `POST /store/reviews` (Mercur's auth and body validation still apply). A
 * buyer reviews a shop or a product only once they received the order that brought it (#7);
 * the review waits for moderation.
 */
export const POST = async (req: AuthenticatedMedusaRequest<StoreCreateReviewType>, res: MedusaResponse<StoreReviewResponse>) => {
  const { result } = await submitReviewWorkflow(req.scope).run({
    input: { ...req.validatedBody, customer_id: req.auth_context.actor_id },
  })
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [review] } = await query.graph({ entity: "review", fields: req.queryConfig.fields, filters: { id: result.id } })
  res.status(201).json({ review: review as unknown as StoreReviewResponse["review"] })
}
