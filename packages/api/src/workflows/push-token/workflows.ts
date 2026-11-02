import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { forgetBuyerLiveUpdatesStep } from "../live-activity-token/steps"
import { forgetPushDevicesStep, registerPushTokenStep, removePushTokenStep, type PushTokenInput, type RegisterPushTokenInput } from "./steps"

/** A buyer's or member's device registers for pushes once they are signed in on it (#27). */
export const registerPushTokenWorkflow = createWorkflow("register-push-token", (input: RegisterPushTokenInput) => {
  return new WorkflowResponse(registerPushTokenStep(input))
})

/** A device stops getting the person's pushes when they sign out of it. */
export const removePushTokenWorkflow = createWorkflow("remove-push-token", (input: PushTokenInput) => {
  const removed = removePushTokenStep(input)
  when({ input }, ({ input }) => input.actor_type === "customer").then(() => {
    forgetBuyerLiveUpdatesStep(transform({ input }, ({ input }) => ({ push_token: input.token, customer_id: input.actor_id })))
  })
  return new WorkflowResponse(removed)
})

/** Devices Expo says are no longer installed stop getting anyone's pushes. */
export const forgetPushDevicesWorkflow = createWorkflow("forget-push-devices", (input: { tokens: string[] }) => {
  return new WorkflowResponse(forgetPushDevicesStep(input))
})
