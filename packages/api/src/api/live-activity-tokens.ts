import type { MedusaRequest, MedusaResponse, AuthenticatedMedusaRequest } from "@medusajs/framework/http"
import { LIVE_ACTIVITY_KEY_HEADER } from "@oja/domain"
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"
import { buyerOrder } from "../lib/buyer-notifications"
import { owedBuyerActivities, type OwedActivity } from "../lib/buyer-live-activity"
import { APNS_ENVIRONMENTS, LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityTokenModuleService } from "../modules/live-activity-token"
import { hashDeviceKey } from "../workflows/live-activity-token/steps"
import {
  recordLiveActivityStartedWorkflow,
  registerLiveActivityDeviceWorkflow,
  removeLiveActivityDeviceWorkflow,
  reportLiveActivityTokenWorkflow,
} from "../workflows/live-activity-token/workflows"

// A phone's Live Activity tokens (#143, ADR 0018). iOS can hand the app a token on a background
// launch, before auth is restored or on a locked phone, so tokens are posted with the key the phone
// was given while signed in, not a session. Signing out deletes the key's row, so it stops working.

const ApnsToken = z.string().trim().regex(/^[0-9a-fA-F]{16,512}$/)
const Environment = z.enum(APNS_ENVIRONMENTS)

export const LiveActivityDeviceBody = z.object({
  environment: Environment,
  push_token: z
    .string()
    .trim()
    .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/)
    .optional(),
})
export type LiveActivityDeviceBodyType = z.infer<typeof LiveActivityDeviceBody>

export const LiveActivityTokenBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("push_to_start"), token: ApnsToken, environment: Environment }),
  z.object({ kind: z.literal("activity"), token: ApnsToken, environment: Environment, activity_id: z.string().trim().min(1).max(100) }),
])
export type LiveActivityTokenBodyType = z.infer<typeof LiveActivityTokenBody>

export const LiveActivityStartedBody = z.object({
  order_id: z.string().trim().min(1).max(100),
  activity_id: z.string().trim().min(1).max(100),
  environment: Environment,
})
export type LiveActivityStartedBodyType = z.infer<typeof LiveActivityStartedBody>

export type LiveActivityDeviceResponse = { device: { key: string } }
export type LiveActivityDeviceDeleteResponse = { deleted: true }
export type LiveActivityTokenResponse = { token: string }
export type LiveActivityStartedResponse = { activity_id: string }
export type OwedActivitiesResponse = { activities: OwedActivity[] }

const keyOf = (req: MedusaRequest) => {
  const key = req.headers[LIVE_ACTIVITY_KEY_HEADER]
  return typeof key === "string" && key ? key : null
}

/** The phone the request's key belongs to; 401 for none, as a dead session would be. */
async function deviceOf(req: MedusaRequest) {
  const key = keyOf(req)
  const [device] = key
    ? await req.scope.resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE).listLiveActivityDevices({ key_hash: hashDeviceKey(key) })
    : []
  if (!device) throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "This device isn't registered")
  return device
}

/** Gives a signed-in buyer's phone its key, or moves the phone it already names to them. */
export const registerBuyerDevice = async (
  req: AuthenticatedMedusaRequest<LiveActivityDeviceBodyType>,
  res: MedusaResponse<LiveActivityDeviceResponse>
) => {
  const { result } = await registerLiveActivityDeviceWorkflow(req.scope).run({
    input: {
      app: "buyer",
      actor_type: "customer",
      actor_id: req.auth_context.actor_id,
      key: keyOf(req) ?? undefined,
      environment: req.validatedBody.environment,
      push_token: req.validatedBody.push_token,
    },
  })
  res.json({ device: { key: result.key } })
}

/** At sign-out: forgets the phone and its tokens, if it is still this buyer's. */
export const removeBuyerDevice = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<LiveActivityDeviceDeleteResponse>) => {
  const key = keyOf(req)
  if (key) {
    await removeLiveActivityDeviceWorkflow(req.scope).run({
      input: { key, actor_type: "customer", actor_id: req.auth_context.actor_id },
    })
  }
  res.json({ deleted: true })
}

/** Takes a token from a phone, with its key. */
export const reportToken = async (req: MedusaRequest<LiveActivityTokenBodyType>, res: MedusaResponse<LiveActivityTokenResponse>) => {
  const device = await deviceOf(req)
  const { result } = await reportLiveActivityTokenWorkflow(req.scope).run({
    input: { ...(req.validatedBody as LiveActivityTokenBodyType), device_id: device.id },
  })
  res.json({ token: result.token })
}

/** A phone below iOS 17.2 says it started an order's activity; only its own buyer's order. */
export const recordStarted = async (req: MedusaRequest<LiveActivityStartedBodyType>, res: MedusaResponse<LiveActivityStartedResponse>) => {
  const device = await deviceOf(req)
  const { order_id, activity_id, environment } = req.validatedBody as LiveActivityStartedBodyType
  const found = await buyerOrder(req.scope, order_id)
  if (!found || device.actor_type !== "customer" || found.checkout.customer_id !== device.actor_id) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Order not found")
  }
  const { result } = await recordLiveActivityStartedWorkflow(req.scope).run({
    input: { device_id: device.id, order_id, activity_id, environment },
  })
  res.json({ activity_id: result.activity_id })
}

/** What a phone below iOS 17.2 should start itself, once its buyer opens the app. */
export const listOwed = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<OwedActivitiesResponse>) => {
  const key = keyOf(req)
  res.json({ activities: key ? await owedBuyerActivities(req.scope, req.auth_context.actor_id, key) : [] })
}
