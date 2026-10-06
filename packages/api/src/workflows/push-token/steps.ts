import type { MedusaContainer } from "@medusajs/framework/types"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { PUSH_TOKEN_MODULE, type PushTokenActor, type PushTokenModuleService } from "../../modules/push-token"

export type PushTokenInput = { token: string; actor_type: PushTokenActor; actor_id: string }

type SavedPushToken = PushTokenInput & { id: string }

const pushTokenService = (scope: Pick<MedusaContainer, "resolve">) => scope.resolve<PushTokenModuleService>(PUSH_TOKEN_MODULE)

/** Registers the device for the person signed in on it, moving it from whoever had it before. */
export const registerPushTokenStep = createStep(
  "register-push-token",
  async (input: PushTokenInput, { container }) => {
    const tokens = pushTokenService(container)
    const [previous] = (await tokens.listPushTokens({ token: input.token })) as SavedPushToken[]
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
  async (compensation: { previous?: SavedPushToken; created?: string } | undefined, { container }) => {
    const tokens = pushTokenService(container)
    if (compensation?.created) await tokens.deletePushTokens(compensation.created)
    const previous = compensation?.previous
    if (previous) {
      await tokens.updatePushTokens({ id: previous.id, actor_type: previous.actor_type, actor_id: previous.actor_id })
    }
  }
)

/** Forgets the device, if it is still registered to this person: someone else may have signed in on it since. */
export const removePushTokenStep = createStep(
  "remove-push-token",
  async (input: PushTokenInput, { container }) => {
    const tokens = pushTokenService(container)
    const owned = (await tokens.listPushTokens(input)) as SavedPushToken[]
    if (owned.length) await tokens.deletePushTokens(owned.map((t) => t.id))
    return new StepResponse({ token: input.token }, owned)
  },
  async (removed: SavedPushToken[] | undefined, { container }) => {
    if (!removed?.length) return
    await pushTokenService(container).createPushTokens(
      removed.map(({ token, actor_type, actor_id }) => ({ token, actor_type, actor_id }))
    )
  }
)

/** Forgets devices Expo says are gone (`DeviceNotRegistered`), whoever they were registered to. */
export const forgetPushDevicesStep = createStep(
  "forget-push-devices",
  async (input: { tokens: string[] }, { container }) => {
    const tokens = pushTokenService(container)
    const gone = input.tokens.length ? ((await tokens.listPushTokens({ token: input.tokens })) as SavedPushToken[]) : []
    if (gone.length) await tokens.deletePushTokens(gone.map((t) => t.id))
    return new StepResponse({ forgotten: gone.map((t) => t.token) }, gone)
  },
  async (gone: SavedPushToken[] | undefined, { container }) => {
    if (!gone?.length) return
    await pushTokenService(container).createPushTokens(
      gone.map(({ token, actor_type, actor_id }) => ({ token, actor_type, actor_id }))
    )
  }
)
