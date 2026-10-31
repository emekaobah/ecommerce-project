import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import {
  forgetSearchesStep,
  publishPopularSearchesStep,
  recordSearchStep,
  type PopularSearchesInput,
  type SearchRecordInput,
} from "./steps"

/** A buyer used a search on the Search tab (#124). */
export const recordSearchWorkflow = createWorkflow("record-search", (input: SearchRecordInput) => {
  return new WorkflowResponse(recordSearchStep(input))
})

/** The hourly job publishes a region's popular searches. */
export const publishPopularSearchesWorkflow = createWorkflow("publish-popular-searches", (input: PopularSearchesInput) => {
  return new WorkflowResponse(publishPopularSearchesStep(input))
})

/** Searches older than the retention period are deleted. */
export const forgetSearchesWorkflow = createWorkflow("forget-searches", (input: { before: Date }) => {
  return new WorkflowResponse(forgetSearchesStep(input))
})
