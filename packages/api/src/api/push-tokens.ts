import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import type { PushTokenActor } from "../modules/push-token"
import { registerPushTokenWorkflow, removePushTokenWorkflow } from "../workflows/push-token/workflows"

// A device registers for pushes, and is removed at sign-out, from both apps (#27): buyers at
// /store/push-tokens, shop members at /vendor/push-tokens.

/** An Expo push token, as `getExpoPushTokenAsync` returns it on the device. */
export const PushTokenBody = z.object({ token: z.string().trim().regex(/^Expo(nent)?PushToken\[[^\]]+\]$/) })
export type PushTokenBodyType = z.infer<typeof PushTokenBody>

export type PushTokenResponse = { push_token: { token: string } }
export type PushTokenDeleteResponse = { token: string; deleted: true }

/** Registers the device for the signed-in buyer or member. */
export const registerPushToken =
  (actorType: PushTokenActor) =>
  async (req: AuthenticatedMedusaRequest<PushTokenBodyType>, res: MedusaResponse<PushTokenResponse>) => {
    const { result } = await registerPushTokenWorkflow(req.scope).run({
      input: { token: req.validatedBody.token, actor_type: actorType, actor_id: req.auth_context.actor_id },
    })
    res.json({ push_token: result })
  }

/** Removes the device from the signed-in buyer or member; a device someone else has since signed in on stays theirs. */
export const removePushToken =
  (actorType: PushTokenActor) =>
  async (req: AuthenticatedMedusaRequest, res: MedusaResponse<PushTokenDeleteResponse>) => {
    const token = req.params.token
    await removePushTokenWorkflow(req.scope).run({
      input: { token, actor_type: actorType, actor_id: req.auth_context.actor_id },
    })
    res.json({ token, deleted: true })
  }
