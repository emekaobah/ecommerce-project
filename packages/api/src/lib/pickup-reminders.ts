import { holdReminderDue } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { remindPickupHoldWorkflow } from "../workflows/order-fulfilment/workflows/remind-pickup-hold"
import { errorMessage } from "./errors"
import { heldOrders } from "./pickup-hold-expiry"

type Scope = Pick<MedusaContainer, "resolve">

/**
 * The hold-reminder job (#33): reminds the buyer of each order Ready for pickup, while its shop is
 * open, half-way through its hold and on its last day (`holdReminderDue`), once each.
 */
export async function remindPickupHolds(scope: Scope, now = new Date()) {
  const due = (await heldOrders(scope, now)).flatMap(({ row, hours, lines }) => {
    const readyAt = row.reached?.ready_for_pickup
    const reminder = hours && lines && readyAt ? holdReminderDue(hours, readyAt, lines, now, row.hold_reminded ?? null) : null
    return reminder ? [{ order_id: row.order_id, reminder }] : []
  })
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  // Each order's reminder is its own, so they go out together.
  await Promise.all(
    due.map(({ order_id, reminder }) =>
      remindPickupHoldWorkflow(scope as MedusaContainer)
        .run({ input: { order_id, reminder, at: now.toISOString() } })
        .catch((error: unknown) => {
          // Collected meanwhile, most likely; the next run looks again.
          logger.warn(`Reminding the buyer of pickup order ${order_id} failed: ${errorMessage(error)}`)
        })
    )
  )
}
