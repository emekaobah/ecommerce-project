import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { PUSH_TOKEN_MODULE, type PushTokenActor, type PushTokenModuleService } from "../../modules/push-token"

export type PushTokenInput = { token: string; actor_type: PushTokenActor; actor_id: string }

type Saved = { id: string; token: string; actor_type: PushTokenActor; actor_id: string }

const service = (container: { resolve: <T>(key: string) => T }) => container.resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE)

/** Registers the device for the person signed in on it, moving it from whoever had it before. */
export const registerPushTokenStep = createStep(
  "register-push-token",
  async (input: PushTokenInput, { container }) => {
    const tokens = service(container)
    const [previous] = (await tokens.listPushTokens({ token: input.token })) as Saved[]
    if (previous?.actor_type === input.actor_type && previous.actor_id === input.actor_id) {
      return new StepResponse({ token: input.token }, {})
    }
    if (previous) {
      await tokens.updatePushTokens({ id: previous.id, actor_type: input.actor_type, actor_id: input.actor_id })
      return new StepResponse({ token: input.token }, { previous })
    }
    const created = await tokens.createPushTokens(input)
    return new StepResponse({ token: input.token }, { created: created.id })
  },
  async (compensation: { previous?: Saved; created?: string } | undefined, { container }) => {
    if (compensation?.created) await service(container).deletePushTokens(compensation.created)
    const previous = compensation?.previous
    if (previous) {
      await service(container).updatePushTokens({ id: previous.id, actor_type: previous.actor_type, actor_id: previous.actor_id })
    }
  }
)

/** Forgets the device, if it is still registered to this person: someone else may have signed in on it since. */
export const removePushTokenStep = createStep(
  "remove-push-token",
  async (input: PushTokenInput, { container }) => {
    const tokens = service(container)
    const owned = (await tokens.listPushTokens(input)) as Saved[]
    if (owned.length) await tokens.deletePushTokens(owned.map((t) => t.id))
    return new StepResponse({ token: input.token }, owned)
  },
  async (removed: Saved[] | undefined, { container }) => {
    if (!removed?.length) return
    await service(container).createPushTokens(removed.map(({ token, actor_type, actor_id }) => ({ token, actor_type, actor_id })))
  }
)
