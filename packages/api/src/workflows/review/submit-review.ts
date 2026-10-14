import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { createReviewWorkflow } from "@mercurjs/core/workflows"
import type { CreateReviewDTO } from "@mercurjs/types"
import { assertReviewable } from "../../lib/reviews"

/** Refuses a review the buyer may not write (`assertReviewable`): only what a received order brought them. */
const checkReviewableStep = createStep("check-reviewable", async (input: CreateReviewDTO, { container }) => {
  await assertReviewable(container, input)
  return new StepResponse(undefined)
})

/**
 * A buyer reviews a shop, or a product, of one of their orders (#7). Mercur's create workflow
 * only checks the order is the buyer's; this one first checks the buyer received it. The review
 * starts pending moderation.
 */
export const submitReviewWorkflow = createWorkflow("submit-review", (input: CreateReviewDTO) => {
  checkReviewableStep(input)
  const review = createReviewWorkflow.runAsStep({ input })
  return new WorkflowResponse(review)
})
