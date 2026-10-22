import { ORDER_STAGES, statesInStage, type OrderStage } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { fulfilmentService } from "./order-fulfilment"

// The vendor app's stage tiles (#69): a shop's unfinished orders by stage (`@oja/domain`'s
// mapping), counted and listed through the fulfilment rows' (seller_id, state) index.

type Scope = Pick<MedusaContainer, "resolve">

export type StageCounts = Record<OrderStage, number>

/** How many of the shop's orders are in each stage. */
export async function stageCounts(scope: Scope, sellerId: string): Promise<StageCounts> {
  const service = fulfilmentService(scope)
  const counts = await Promise.all(
    ORDER_STAGES.map(async (stage) => {
      const [, count] = await service.listAndCountOrderFulfilments(
        { seller_id: sellerId, state: statesInStage(stage) },
        { select: ["id"], take: 1 }
      )
      return [stage, count] as const
    })
  )
  return Object.fromEntries(counts) as StageCounts
}

/** A page of the shop's orders in the stage, newest first: their ids, and how many there are in all. */
export async function ordersInStage(
  scope: Scope,
  sellerId: string,
  stage: OrderStage,
  page: { limit: number; offset: number }
): Promise<{ order_ids: string[]; count: number }> {
  const [rows, count] = await fulfilmentService(scope).listAndCountOrderFulfilments(
    { seller_id: sellerId, state: statesInStage(stage) },
    { select: ["order_id"], order: { placed_at: "DESC", id: "DESC" }, skip: page.offset, take: page.limit }
  )
  return { order_ids: rows.map((r) => r.order_id), count }
}
