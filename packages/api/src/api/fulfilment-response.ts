import { fulfilmentView, type FulfilmentRecord, type FulfilmentView } from "../lib/order-fulfilment"

// What staff see of an order's fulfilment after changing it, from the vendor app's order routes
// and the admin's (cancelling an order, #17).

export type OrderFulfilmentResponse = { fulfilment: FulfilmentView }

/**
 * The response to a transition: what staff now see of the order's fulfilment. A transition
 * never leaves an order New, so it has no accept deadline to count in the shop's hours.
 * `names`: members' names by id, for who handed the order over.
 */
export const fulfilmentResponse = (record: FulfilmentRecord, names?: Map<string, string>): OrderFulfilmentResponse => ({
  fulfilment: fulfilmentView(record, undefined, null, { names }),
})
