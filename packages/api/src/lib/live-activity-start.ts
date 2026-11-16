import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ApnsEnvironment, LiveActivityPushResult } from "../modules/live-activity-push"
import { LIVE_ACTIVITY_TOKEN_MODULE, type LiveActivityKind, type LiveActivityTokenModuleService } from "../modules/live-activity-token"
import { errorMessage } from "./errors"

type Scope = Pick<MedusaContainer, "resolve">

/** The row a start records: one phone's activity about one order or shop. */
export type StartClaim = { device_id: string; kind: LiveActivityKind; subject_id: string; environment: ApnsEnvironment; started_at: Date }

/**
 * Starts an activity on one phone, recording it first so a repeat of the event can't start a
 * second. `send` asks for the start, given the new row's id; null means the phone can't be reached
 * yet. Answers the row's id if the start was sent. If not, nothing stays recorded, and when the
 * start went by the phone's push-to-start token (`byPushToStart`) and Apple rejected it, the phone
 * forgets that token. `about` names the activity in the logs.
 */
export async function claimAndStart(
  scope: Scope,
  claim: StartClaim,
  about: string,
  send: (claimId: string) => Promise<LiveActivityPushResult["status"] | null>,
  { byPushToStart }: { byPushToStart: boolean }
): Promise<string | null> {
  const store = scope.resolve<LiveActivityTokenModuleService>(LIVE_ACTIVITY_TOKEN_MODULE)
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  let id: string
  try {
    ;({ id } = await store.createLiveActivities(claim))
  } catch (error) {
    // Another event of the same moment got there first, or an earlier one is still running.
    logger.warn(`Recording the ${about} failed: ${errorMessage(error)}`)
    return null
  }
  const status = await send(id)
  if (status === "sent") return id
  try {
    await store.deleteLiveActivities(id)
  } catch (error) {
    // At least stop it being the running one, so an activity it was to replace can be again.
    logger.warn(`Forgetting the refused ${about} failed: ${errorMessage(error)}`)
    await store.updateLiveActivities({ id, ended_at: new Date() }).catch(() => {})
  }
  if (status === "token_rejected" && byPushToStart) {
    await store.updateLiveActivityDevices({ id: claim.device_id, push_to_start_token: null }).catch((error) => {
      logger.warn(`Forgetting a rejected push-to-start token failed: ${errorMessage(error)}`)
    })
  }
  return null
}
