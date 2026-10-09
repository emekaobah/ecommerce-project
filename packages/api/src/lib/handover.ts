import { handoverDisagreement } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { alertHandoverDisagreementWorkflow } from "../workflows/order-fulfilment/workflows/alert-handover-disagreement"
import { errorMessage } from "./errors"
import { asFulfilmentRecord, fulfilmentService } from "./order-fulfilment"

// The handover to the courier needs both the staff tap and Shipbubble's pickup (#25). When one
// arrives and the other doesn't, the shop's owner is told to check.

/**
 * Alerts the owner of each order whose handover has had one half and not the other for too long
 * (`handoverDisagreement`, `@oja/domain`), once per shipment.
 */
export async function alertHandoverDisagreements(scope: MedusaContainer, now = new Date()) {
  const waiting = (
    await fulfilmentService(scope).listOrderFulfilments({ state: "courier_confirmed", handover_alerted_at: null })
  ).map(asFulfilmentRecord)
  const due = waiting.flatMap((row) => {
    const disagreement = handoverDisagreement(row.fulfilment, now)
    return disagreement ? [{ order_id: row.order_id, waiting_for: disagreement.waiting_for }] : []
  })
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  // Each order's alert is its own, so they go out together.
  await Promise.all(
    due.map((input) =>
      alertHandoverDisagreementWorkflow(scope)
        .run({ input: { ...input, at: now.toISOString() } })
        .catch((error: unknown) => {
          // Handed over meanwhile, most likely; the next run looks again.
          logger.warn(`Alerting the owner about order ${input.order_id}'s handover failed: ${errorMessage(error)}`)
        })
    )
  )
}
