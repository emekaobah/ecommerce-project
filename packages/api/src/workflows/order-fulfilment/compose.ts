import type { StaffActionType } from "@oja/domain"
import { acquireLockStep } from "@medusajs/medusa/core-flows"
import { transform } from "@medusajs/framework/workflows-sdk"

// Pieces the order-fulfilment workflows are composed from.

/**
 * Takes the order's fulfilment lock, so one change to an order's fulfilment runs at a time.
 * Returns its key, for `releaseLockStep` at the end of the workflow. `ttl` (seconds) is how
 * long the lock outlives a workflow that never releases it; a longer workflow needs more.
 */
export function lockOrderFulfilment(input: { order_id: string }, ttl = 30) {
  const key = transform({ input }, ({ input }) => `order-fulfilment:${input.order_id}`)
  acquireLockStep({ key, timeout: 5, ttl })
  return key
}

/** A staff action on the order, by the member in `input.actor`, now. */
export function staffTrigger<T extends StaffActionType>(input: { actor: string }, type: T) {
  return transform({ input }, ({ input }) => ({
    source: "staff" as const,
    type,
    actor: input.actor,
    at: new Date().toISOString(),
  }))
}
