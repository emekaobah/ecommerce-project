import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, NotificationStatus } from "@medusajs/framework/utils"
import { PUSH_CHANNEL } from "../modules/expo-push"
import { DEVICE_NOT_REGISTERED, expoError, expoPushApi, expoPushOptionsFromEnv, type ExpoReceipt } from "../modules/expo-push/expo-api"
import { forgetPushDevicesWorkflow } from "../workflows/push-token/workflows"
import { errorMessage } from "./errors"

// Devices Expo says are gone (#27). Expo reports an uninstalled app as `DeviceNotRegistered`,
// either straight away on the push's ticket or, once it has tried to deliver it, on the
// ticket's receipt. Either way the device is forgotten, so it is not pushed to again.

type Scope = Pick<MedusaContainer, "resolve">

const MINUTE = 60 * 1000
/** Expo has a ticket's receipt ready about 15 minutes after the push. */
const RECEIPT_DELAY_MS = 15 * MINUTE
/** How often the receipts job runs. */
const RECEIPT_CHECK_EVERY_MS = 60 * MINUTE
/** Each run looks a little further back than the last run, so a late run misses no push. */
const RECEIPT_CHECK_OVERLAP_MS = 5 * MINUTE

/** Forgets the devices, whoever they were registered to; they are logged if that fails. */
export async function forgetPushDevices(scope: Scope, tokens: string[]): Promise<void> {
  if (!tokens.length) return
  try {
    await forgetPushDevicesWorkflow(scope as MedusaContainer).run({ input: { tokens } })
  } catch (error) {
    scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .warn(`Forgetting ${tokens.length} uninstalled push device(s) failed: ${errorMessage(error)}`)
  }
}

/**
 * Asks Expo for the receipts of the pushes it accepted between 15 and 80 minutes ago, and
 * forgets each device a receipt says is no longer installed. Expo keeps receipts for a day;
 * if it can't be asked, the next ticket to that device reports it gone instead.
 */
export async function checkPushReceipts(scope: Scope, now = new Date()): Promise<void> {
  const until = now.getTime() - RECEIPT_DELAY_MS
  const since = until - RECEIPT_CHECK_EVERY_MS - RECEIPT_CHECK_OVERLAP_MS
  const pushes = await scope.resolve(Modules.NOTIFICATION).listNotifications(
    { channel: PUSH_CHANNEL, created_at: { $gte: new Date(since).toISOString(), $lt: new Date(until).toISOString() } },
    { select: ["to", "status", "external_id"] }
  )
  const deviceOfTicket = new Map(
    pushes.filter((p) => p.status === NotificationStatus.SUCCESS && p.external_id).map((p) => [p.external_id!, p.to])
  )
  if (!deviceOfTicket.size) return

  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const receipts = await expoPushApi(expoPushOptionsFromEnv())
    .receipts([...deviceOfTicket.keys()])
    .catch((error): Record<string, ExpoReceipt> => {
      logger.warn(`Checking push receipts failed: ${errorMessage(error)}`)
      return {}
    })
  const gone = new Set<string>()
  for (const [ticketId, receipt] of Object.entries(receipts)) {
    const device = deviceOfTicket.get(ticketId)
    if (receipt.status !== "error" || !device) continue
    if (expoError(receipt) === DEVICE_NOT_REGISTERED) gone.add(device)
    else logger.warn(`Expo could not deliver push ticket ${ticketId}: ${expoError(receipt)}`)
  }
  await forgetPushDevices(scope, [...gone])
}
