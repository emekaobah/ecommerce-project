import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { fulfilmentService, fulfilmentsOf, newFulfilmentRow, placedOrdersOf } from "../lib/order-fulfilment"

/** How many orders the backfill reads at a time. */
const BACKFILL_BATCH = 200

/**
 * Gives every order without a fulfilment row one, New as readers took it to be, fills in whose
 * order each row is on rows recorded before rows said (#58), and works out each row's phase from
 * its state and refunds (#59). Running it again changes nothing.
 */
export async function backfillOrderFulfilments(
  scope: Pick<MedusaContainer, "resolve">
): Promise<{ created: number; filled: number; phased: number }> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const service = fulfilmentService(scope)
  let created = 0
  let filled = 0
  let phased = 0
  for (let skip = 0; ; skip += BACKFILL_BATCH) {
    const { data } = await query.graph({
      entity: "order",
      fields: ["id"],
      filters: { is_draft_order: false },
      pagination: { skip, take: BACKFILL_BATCH, order: { created_at: "ASC" } },
    })
    const ids = (data as { id: string }[]).map((o) => o.id)
    if (!ids.length) break
    const [records, placed] = await Promise.all([fulfilmentsOf(scope, ids), placedOrdersOf(scope, ids)])
    const missing = [...placed.values()].filter((o) => !records.has(o.order_id))
    const unfilled = [...records.values()].filter((r) => !r.seller_id && placed.has(r.order_id))
    if (missing.length) await service.createOrderFulfilments(missing.map(newFulfilmentRow))
    if (unfilled.length) {
      await service.updateOrderFulfilments(
        unfilled.map((r) => {
          const { customer_id, seller_id, order_group_id } = placed.get(r.order_id)!
          return { id: r.id, customer_id, seller_id, order_group_id }
        })
      )
    }
    created += missing.length
    filled += unfilled.length
    phased += await service.refreshOrderPhases(ids)
  }
  return { created, filled, phased }
}

/**
 * Every order gets a fulfilment row, every row says whose order it is (#58), and its phase
 * (#59). Run once by `medusa db:migrate`, after the links the rows are filled from are synced.
 */
export default async function backfillOrderFulfilmentsScript({ container }: Pick<ExecArgs, "container">) {
  const { created, filled, phased } = await backfillOrderFulfilments(container)
  container
    .resolve(ContainerRegistrationKeys.LOGGER)
    .info(
      `Order fulfilments backfilled: ${created} orders given a row, ${filled} rows told whose order they are, ${phased} rows given their phase`
    )
}
