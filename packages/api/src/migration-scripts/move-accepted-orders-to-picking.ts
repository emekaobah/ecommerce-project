import { recordReached, transition } from "@oja/domain"
import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { asFulfilmentRecord, fulfilmentService } from "../lib/order-fulfilment"

/** Who the moves are recorded as made by: no member made them. */
const MIGRATION_ACTOR = "migration:move-accepted-orders-to-picking"

/**
 * Accepting an order starts picking it (#70), so no order waits in Accepted any more. Moves each
 * order left there, accepted before, on to Picking by the state machine, as picking it from
 * when it was accepted, and refreshes its phase. Running it again changes nothing.
 */
export async function moveAcceptedOrdersToPicking(scope: Pick<MedusaContainer, "resolve">): Promise<number> {
  const service = fulfilmentService(scope)
  const rows = (await service.listOrderFulfilments({ state: "accepted" })).map(asFulfilmentRecord)
  const now = new Date().toISOString()
  for (const row of rows) {
    const at = row.reached?.accepted ?? now
    const result = transition(row.fulfilment, { source: "staff", type: "start_picking", actor: MIGRATION_ACTOR, at })
    if (!result.ok) throw new Error(`Order ${row.order_id} is accepted but can't start picking: ${result.error.from}`)
    await service.updateOrderFulfilments({
      selector: { id: row.id, state: "accepted" },
      data: {
        state: result.fulfilment.state,
        fulfilment: result.fulfilment,
        reached: recordReached(row.reached ?? {}, row.fulfilment, result.fulfilment, at),
      },
    })
  }
  await service.refreshOrderPhases(rows.map((r) => r.order_id))
  return rows.length
}

/** Run once by `medusa db:migrate`. */
export default async function moveAcceptedOrdersToPickingScript({ container }: Pick<ExecArgs, "container">) {
  const moved = await moveAcceptedOrdersToPicking(container)
  container.resolve(ContainerRegistrationKeys.LOGGER).info(`Orders moved from Accepted to Picking: ${moved}`)
}
