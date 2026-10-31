import type { MedusaContainer } from "@medusajs/framework/types"
import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { NOTIFICATION_PREFERENCE_MODULE, type NotificationPreferenceModuleService } from "../../modules/notification-preference"
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  settingsOf,
  type NotificationPreferences,
  type NotificationPreferencesChange,
} from "../../lib/notification-preferences"

export type SetNotificationPreferencesInput = { customer_id: string; change: NotificationPreferencesChange }

type Saved = NotificationPreferences & { id: string }

const preferenceService = (scope: Pick<MedusaContainer, "resolve">) =>
  scope.resolve<NotificationPreferenceModuleService>(NOTIFICATION_PREFERENCE_MODULE)

/** Changes the buyer's settings named in the change, keeping the others; makes their row the first time. */
export const setNotificationPreferencesStep = createStep(
  "set-notification-preferences",
  async (input: SetNotificationPreferencesInput, { container }) => {
    const service = preferenceService(container)
    const [previous] = (await service.listNotificationPreferences({ customer_id: input.customer_id })) as Saved[]
    if (previous) {
      const updated = (await service.updateNotificationPreferences({ id: previous.id, ...input.change })) as Saved
      return new StepResponse(settingsOf(updated), { previous })
    }
    const created = (await service.createNotificationPreferences({
      customer_id: input.customer_id,
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...input.change,
    })) as Saved
    return new StepResponse(settingsOf(created), { created: created.id })
  },
  async (compensation: { previous?: Saved; created?: string } | undefined, { container }) => {
    const service = preferenceService(container)
    if (compensation?.created) await service.deleteNotificationPreferences(compensation.created)
    const previous = compensation?.previous
    if (previous) await service.updateNotificationPreferences({ id: previous.id, ...settingsOf(previous) })
  }
)

/** A buyer turns a notification setting on or off (#138). */
export const setNotificationPreferencesWorkflow = createWorkflow(
  "set-notification-preferences",
  (input: SetNotificationPreferencesInput) => new WorkflowResponse(setNotificationPreferencesStep(input))
)
