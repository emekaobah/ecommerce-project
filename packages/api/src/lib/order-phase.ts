import { orderPhase, type FulfilmentState, type OrderPhase, type RefundStatus } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { fulfilmentService, fulfilmentsOf } from "./order-fulfilment"

// Each order's stored phase (#59): in progress or past for its buyer, by `@oja/domain`'s
// `orderPhase` of its state and its refunds. A transition writes it with the state; every
// writer of an order's refunds rewrites it after (`syncOrderPhases`).

type Scope = Pick<MedusaContainer, "resolve">

/** An order's refund (`order_refund`), as much of it as its phase reads. */
export type PhaseRefundRow = { status: string; handed_over_at?: Date | string | null }

/** The phase of an order in the state with these refunds. */
export const phaseOf = (state: FulfilmentState, refunds: readonly PhaseRefundRow[]): OrderPhase =>
  orderPhase(
    state,
    refunds.map((r) => ({ status: r.status as RefundStatus, handed_over: !!r.handed_over_at }))
  )

/** The order's refunds, as its phase reads them. */
export async function phaseRefundsOf(scope: Scope, orderId: string): Promise<PhaseRefundRow[]> {
  return fulfilmentService(scope).listOrderRefunds({ order_id: orderId }, { select: ["status", "handed_over_at"] })
}

/**
 * Rewrites each order's stored phase from its state and its refunds, where it changed; called
 * after an order's refunds are written. An order with no fulfilment row (a refund of no order)
 * is left be. Each row is rewritten only while its state is still the one read, so a transition
 * meanwhile, which writes its own phase, isn't undone. Returns how many rows changed.
 */
export async function syncOrderPhases(scope: Scope, orderIds: readonly (string | null | undefined)[]): Promise<number> {
  const ids = [...new Set(orderIds.filter((id): id is string => !!id))]
  if (!ids.length) return 0
  const service = fulfilmentService(scope)
  const [records, refunds] = await Promise.all([
    fulfilmentsOf(scope, ids),
    service.listOrderRefunds({ order_id: ids }, { select: ["order_id", "status", "handed_over_at"] }),
  ])
  const changed = [...records.values()].flatMap((record) => {
    const phase = phaseOf(
      record.state,
      refunds.filter((r) => r.order_id === record.order_id)
    )
    return phase === record.phase ? [] : [{ record, phase }]
  })
  for (const { record, phase } of changed) {
    await service.updateOrderFulfilments({ selector: { id: record.id, state: record.state }, data: { phase } })
  }
  return changed.length
}
