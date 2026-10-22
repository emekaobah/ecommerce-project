import type { FulfilmentState } from "./fulfilment"

/**
 * The stages the vendor app's tiles group a shop's unfinished orders into (#69), in the order the
 * tiles show them. The server counts and lists orders by the same mapping, so both agree.
 */
export const ORDER_STAGES = ["new", "picking", "ready", "out"] as const
export type OrderStage = (typeof ORDER_STAGES)[number]

const STATES: Record<OrderStage, FulfilmentState[]> = {
  new: ["new"],
  picking: ["accepted", "picking", "partially_available"],
  ready: ["packed", "label_booked", "ready_for_pickup"],
  out: ["courier_confirmed", "handed_to_courier", "in_transit"],
}

/** The fulfilment states an order in the stage can be in. */
export const statesInStage = (stage: OrderStage): FulfilmentState[] => [...STATES[stage]]

/** The stage an order in the state is in; null once it is finished (rejected, cancelled, delivered, collected or not collected). */
export const orderStageOf = (state: FulfilmentState): OrderStage | null =>
  ORDER_STAGES.find((stage) => STATES[stage].includes(state)) ?? null
