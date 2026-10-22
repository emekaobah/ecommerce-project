import { orderPhase, type FulfilmentState, type OrderPhase, type RefundStatus } from "@oja/domain"
import type { Context, InferTypeOf } from "@medusajs/framework/types"
import { InjectTransactionManager, MedusaContext, MedusaService } from "@medusajs/framework/utils"
import type { SqlEntityManager } from "@medusajs/framework/mikro-orm/postgresql"
import OrderFulfilment from "./models/order-fulfilment"
import ShopPayout from "./models/shop-payout"
import OrderRefund from "./models/order-refund"
import DiscountFunding from "./models/discount-funding"
import RefundSettlement from "./models/refund-settlement"

type Refund = InferTypeOf<typeof OrderRefund>
type CreateRefund = Partial<Refund>
type UpdateRefund = Partial<Refund> & { id: string }

/** The phase of an order in the state with these refunds (#59). */
const phaseOf = (state: string, refunds: Pick<Refund, "status" | "handed_over_at">[]): OrderPhase =>
  orderPhase(
    state as FulfilmentState,
    refunds.map((r) => ({ status: r.status as RefundStatus, handed_over: !!r.handed_over_at }))
  )

/**
 * An order's stored phase (#59), in progress or past for its buyer, has one owner: this service.
 * It is `@oja/domain`'s `orderPhase` of the order's state and refunds, and `refreshOrderPhases`
 * writes it, reading both under the order's row lock. Every write of a refund refreshes its
 * order's phase in the same transaction (`recordRefunds`, `changeRefunds`), and a transition refreshes it after writing the state
 * (`transitionFulfilmentStep`), so whichever writer refreshes last reads the other's write.
 */
class OrderFulfilmentModuleService extends MedusaService({ OrderFulfilment, OrderRefund, ShopPayout, DiscountFunding, RefundSettlement }) {
  /**
   * Rewrites each order's stored phase from its state and its refunds, where it changed. The
   * orders' fulfilment rows are locked first, so two refreshes of an order run one after the
   * other and the later one reads what the earlier one's writer committed. An order with no
   * fulfilment row (a refund of no order) is left be. Returns how many rows changed.
   */
  @InjectTransactionManager()
  async refreshOrderPhases(orderIds: readonly (string | null | undefined)[], @MedusaContext() sharedContext: Context = {}): Promise<number> {
    const ids = [...new Set(orderIds.filter((id): id is string => !!id))].sort()
    if (!ids.length) return 0
    const manager = sharedContext.transactionManager as SqlEntityManager
    await manager.execute(
      `SELECT id FROM order_fulfilment WHERE order_id IN (${ids.map(() => "?").join(", ")}) AND deleted_at IS NULL ORDER BY order_id FOR UPDATE`,
      ids
    )
    const rows = await this.listOrderFulfilments({ order_id: ids }, { select: ["id", "order_id", "state", "phase"] }, sharedContext)
    const refunds = await this.listOrderRefunds({ order_id: ids }, { select: ["order_id", "status", "handed_over_at"] }, sharedContext)
    const changed = rows.flatMap((row) => {
      const phase = phaseOf(
        row.state,
        refunds.filter((r) => r.order_id === row.order_id)
      )
      return phase === row.phase ? [] : [{ id: row.id, phase }]
    })
    if (changed.length) await this.updateOrderFulfilments(changed, sharedContext)
    return changed.length
  }

  /**
   * Records refunds and refreshes their orders' phases in the same transaction: a refund changes
   * its order's phase, so every refund is written through here, never `createOrderRefunds`.
   */
  @InjectTransactionManager()
  async recordRefunds(data: CreateRefund[], @MedusaContext() sharedContext: Context = {}): Promise<Refund[]> {
    const created = await this.createOrderRefunds(data, sharedContext)
    await this.refreshOrderPhases(created.map((r) => r.order_id), sharedContext)
    return created
  }

  /** Changes refunds and refreshes their orders' phases in the same transaction; never `updateOrderRefunds`. */
  @InjectTransactionManager()
  async changeRefunds(data: UpdateRefund[], @MedusaContext() sharedContext: Context = {}): Promise<Refund[]> {
    const updated = await this.updateOrderRefunds(data, sharedContext)
    await this.refreshOrderPhases(updated.map((r) => r.order_id), sharedContext)
    return updated
  }
}

export default OrderFulfilmentModuleService
