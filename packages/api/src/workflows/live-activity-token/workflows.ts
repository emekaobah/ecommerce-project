import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import {
  recordLiveActivityStartedStep,
  registerLiveActivityDeviceStep,
  removeLiveActivityDeviceStep,
  reportLiveActivityTokenStep,
  setLiveActivityShopStep,
  type RecordStartInput,
  type RegisterDeviceInput,
  type ReportTokenInput,
  type SetShopInput,
} from "./steps"

/** A phone gets its key once someone is signed in on it (ADR 0018). */
export const registerLiveActivityDeviceWorkflow = createWorkflow("register-live-activity-device", (input: RegisterDeviceInput) => {
  return new WorkflowResponse(registerLiveActivityDeviceStep(input))
})

/** A phone stops getting a person's activities when they sign out of it. */
export const removeLiveActivityDeviceWorkflow = createWorkflow(
  "remove-live-activity-device",
  (input: { key: string; actor_type: "customer" | "member"; actor_id: string }) => {
    return new WorkflowResponse(removeLiveActivityDeviceStep(input))
  }
)

/** A phone reports a push-to-start token, or an activity's own update token. */
export const reportLiveActivityTokenWorkflow = createWorkflow("report-live-activity-token", (input: ReportTokenInput) => {
  return new WorkflowResponse(reportLiveActivityTokenStep(input))
})

/** A phone on iOS below 17.2 started an activity itself. */
export const recordLiveActivityStartedWorkflow = createWorkflow("record-live-activity-started", (input: RecordStartInput) => {
  return new WorkflowResponse(recordLiveActivityStartedStep(input))
})

/** A member turns "Orders on Lock Screen" on or off for a shop on their phone. */
export const setLiveActivityShopWorkflow = createWorkflow("set-live-activity-shop", (input: SetShopInput) => {
  return new WorkflowResponse(setLiveActivityShopStep(input))
})
