import type { ProviderEventType, StaffActionType } from "@oja/domain"
import { acquireLockStep } from "@medusajs/medusa/core-flows"
import { transform } from "@medusajs/framework/workflows-sdk"

// Pieces the order-fulfilment workflows are composed from.

/**
 * Takes the order's fulfilment lock, so one change to an order's fulfilment runs at a time.
 * Returns its key, for `releaseLockStep` at the end of the workflow.
 */
export function lockOrderFulfilment(input: { order_id: string }, { ttl = 30 }: { /** Seconds it is held at most. */ ttl?: number } = {}) {
  const key = transform({ input }, ({ input }) => `order-fulfilment:${input.order_id}`)
  acquireLockStep({ key, timeout: 5, ttl })
  return key
}

/** A shipment event the provider reported about the order, now: the one `typeOf` reads from the input. */
export function providerTrigger<I extends object, T extends ProviderEventType>(input: I, typeOf: (input: I) => T) {
  return transform({ input }, ({ input }) => ({
    source: "provider" as const,
    type: typeOf(input as I),
    at: new Date().toISOString(),
  }))
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
