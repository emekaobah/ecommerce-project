import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { forgetPushDevicesStep, registerPushTokenStep, removePushTokenStep, type PushTokenInput } from "./steps"

/** A buyer's or member's device registers for pushes once they are signed in on it (#27). */
export const registerPushTokenWorkflow = createWorkflow("register-push-token", (input: PushTokenInput) => {
  return new WorkflowResponse(registerPushTokenStep(input))
})

/** A device stops getting the person's pushes when they sign out of it. */
export const removePushTokenWorkflow = createWorkflow("remove-push-token", (input: PushTokenInput) => {
  return new WorkflowResponse(removePushTokenStep(input))
})

/** Devices Expo says are no longer installed stop getting anyone's pushes. */
export const forgetPushDevicesWorkflow = createWorkflow("forget-push-devices", (input: { tokens: string[] }) => {
  return new WorkflowResponse(forgetPushDevicesStep(input))
})
