import type { MedusaRequest, MedusaResponse, AuthenticatedMedusaRequest } from "@medusajs/framework/http"
import type { MedusaContainer } from "@medusajs/framework/types"
import { LIVE_ACTIVITY_KEY_HEADER } from "@oja/domain"
import { z } from "@medusajs/framework/zod"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { buyerOrder } from "../lib/buyer-notifications"
import { LIVE_ACTIVITY_TOKEN_REPORTED, owedBuyerActivities, type LiveActivityTokenReported, type OwedActivity } from "../lib/buyer-live-activity"
import type { ApnsEnvironment } from "../modules/live-activity-push"
import {
  APNS_ENVIRONMENTS,
  hashDeviceKey,
  LIVE_ACTIVITY_TOKEN_MODULE,
  type LiveActivityActor,
  type LiveActivityApp,
  type LiveActivityTokenModuleService,
} from "../modules/live-activity-token"
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
const Id = z.string().trim().min(1).max(100)

export const LiveActivityDeviceBody = z.object({
  environment: Environment,
  push_token: z
    .string()
    .trim()
    .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/)
    .optional(),
})
export type LiveActivityDeviceBodyType = z.infer<typeof LiveActivityDeviceBody>

/** What an activity's url names, by the field each app's phones report it in (ADR 0018). */
type Subject = "order_id" | "seller_id"

/** A phone's push-to-start token, or an activity's own token with what its url names under `subject`. */
const tokenBody = <S extends Subject>(subject: S) =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("push_to_start"), token: ApnsToken, environment: Environment }),
    z.object({
      kind: z.literal("activity"),
      token: ApnsToken,
      environment: Environment,
      activity_id: Id,
      ...({ [subject]: Id.optional() } as Record<S, z.ZodOptional<typeof Id>>),
    }),
  ])

/** `tokenBody(subject)`'s output, which zod can't infer while `subject` is generic. */
type TokenBodyType<S extends Subject> =
  | { kind: "push_to_start"; token: string; environment: ApnsEnvironment }
  | ({ kind: "activity"; token: string; environment: ApnsEnvironment; activity_id: string } & Partial<Record<S, string>>)

/** A buyer's report names the shop order its activity's url does. */
export const LiveActivityTokenBody = tokenBody("order_id")

/** A member's report names the shop instead (ADR 0018). */
export const VendorLiveActivityTokenBody = tokenBody("seller_id")

export const LiveActivityStartedBody = z.object({
  order_id: Id,
  activity_id: Id,
  environment: Environment,
})
export type LiveActivityStartedBodyType = z.infer<typeof LiveActivityStartedBody>

export type LiveActivityDeviceResponse = { device: { key: string } }
export type LiveActivityDeviceDeleteResponse = { deleted: true }
export type LiveActivityTokenResponse = { token: string }
export type LiveActivityStartedResponse = { activity_id: string }
export type OwedActivitiesResponse = { activities: OwedActivity[] }

export const keyOf = (req: MedusaRequest<any>) => {
  const key = req.headers[LIVE_ACTIVITY_KEY_HEADER]
  return typeof key === "string" && key ? key : null
}

/** The phone the request's key belongs to; 401 for none, as a dead session would be. */
export async function deviceOf(req: MedusaRequest, app: LiveActivityApp) {
  const key = keyOf(req)
  const [device] = key
    ? await req.scope.resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE).listLiveActivityDevices({ key_hash: hashDeviceKey(key), app })
    : []
  if (!device) throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "This device isn't registered")
  return device
}

/** Gives a signed-in person's phone its key, or moves the phone it already names to them. */
export const registerDevice =
  (app: LiveActivityApp, actor_type: LiveActivityActor) =>
  async (req: AuthenticatedMedusaRequest<LiveActivityDeviceBodyType>, res: MedusaResponse<LiveActivityDeviceResponse>) => {
    const { result } = await registerLiveActivityDeviceWorkflow(req.scope).run({
      input: {
        app,
        actor_type,
        actor_id: req.auth_context.actor_id,
        key: keyOf(req) ?? undefined,
        environment: req.validatedBody.environment,
        push_token: req.validatedBody.push_token,
      },
    })
    res.json({ device: { key: result.key } })
  }

/** At sign-out: forgets the phone and everything of its, if it is still this person's. */
export const removeDevice =
  (actor_type: LiveActivityActor) =>
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse<LiveActivityDeviceDeleteResponse>) => {
    const key = keyOf(req)
    if (key) await removeLiveActivityDeviceWorkflow(req.scope).run({ input: { key, actor_type, actor_id: req.auth_context.actor_id } })
    res.json({ deleted: true })
  }

type Device = Awaited<ReturnType<typeof deviceOf>>

/** How one app's phones report their tokens: what an activity's url names, and what follows a report. */
export type TokenRoute<S extends Subject> = {
  app: LiveActivityApp
  /** The report's field for what the activity's url names. */
  subject: S
  /** Whether that is the device's person's own: a phone's key mustn't tie its token to someone else's. */
  owns: (scope: MedusaContainer, device: Device, subjectId: string) => Promise<boolean>
  /** An activity to catch up, by its row. */
  catchUp: (activityId: string) => LiveActivityTokenReported
  /** A second activity on the phone for a subject it already follows, which has no row. */
  spare: (subjectId: string, report: { token: string; environment: ApnsEnvironment }) => LiveActivityTokenReported
}

/**
 * Takes a token from a phone, with its key. What the activity's url names is trusted only if it's
 * the phone's person's own. One still showing the last person's activity after a sign-out that never
 * reached us has its token kept, and followed by nothing.
 */
export const reportTokenFor =
  <S extends Subject>(route: TokenRoute<S>) =>
  async (req: MedusaRequest<TokenBodyType<S>>, res: MedusaResponse<LiveActivityTokenResponse>) => {
    const device = await deviceOf(req, route.app)
    const body = req.validatedBody as TokenBodyType<S>
    if (body.kind === "push_to_start") {
      const { result } = await reportLiveActivityTokenWorkflow(req.scope).run({ input: { ...body, device_id: device.id } })
      res.json({ token: result.token })
      return
    }
    const { kind, token, environment, activity_id } = body
    const named = (body as Partial<Record<Subject, string>>)[route.subject]
    const subject_id = named && (await route.owns(req.scope, device, named)) ? named : undefined
    const { result } = await reportLiveActivityTokenWorkflow(req.scope).run({ input: { kind, token, environment, activity_id, device_id: device.id, subject_id } })
    let reported: LiveActivityTokenReported | null = null
    if (result.catch_up) reported = route.catchUp(result.catch_up)
    else if (result.spare && subject_id) reported = route.spare(subject_id, { token, environment })
    if (reported) await req.scope.resolve(Modules.EVENT_BUS).emit({ name: LIVE_ACTIVITY_TOKEN_REPORTED, data: reported })
    res.json({ token: result.token })
  }

/** A buyer's phone: the order its activity's url names must be the buyer's, as it carries their pickup code. */
export const reportToken = reportTokenFor({
  app: "buyer",
  subject: "order_id",
  owns: async (scope, device, orderId) => {
    const found = await buyerOrder(scope, orderId)
    return !!found && device.actor_type === "customer" && found.checkout.customer_id === device.actor_id
  },
  catchUp: (id) => ({ id }),
  spare: (order_id, report) => ({ spare: { order_id, ...report } }),
})

/** A phone below iOS 17.2 says it started an order's activity; only its own buyer's order. */
export const recordStarted = async (req: MedusaRequest<LiveActivityStartedBodyType>, res: MedusaResponse<LiveActivityStartedResponse>) => {
  const device = await deviceOf(req, "buyer")
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
