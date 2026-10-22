import { acceptTimeLeft } from "./accept-deadline"
import type { FulfilmentState } from "./fulfilment"
import type { StatusChipView } from "./status"

/** What staff are told of each state: every step, as they work through it. */
const STATES: Record<FulfilmentState, StatusChipView> = {
  new: { label: "New", tone: "new", icon: "clock" },
  accepted: { label: "Accepted", tone: "info", icon: "box" },
  picking: { label: "Picking", tone: "info", icon: "box" },
  // Some lines are short; the pick list says which.
  partially_available: { label: "Picking", tone: "info", icon: "box" },
  packed: { label: "Packed", tone: "info", icon: "box" },
  label_booked: { label: "Label booked", tone: "info", icon: "truck" },
  courier_confirmed: { label: "Courier confirmed", tone: "info", icon: "truck" },
  handed_to_courier: { label: "Handed to courier", tone: "info", icon: "truck" },
  in_transit: { label: "In transit", tone: "info", icon: "truck" },
  delivered: { label: "Delivered", tone: "success", icon: "check" },
  ready_for_pickup: { label: "Ready for pickup", tone: "success", icon: "store" },
  collected: { label: "Collected", tone: "success", icon: "check" },
  rejected: { label: "Rejected", tone: "neutral", icon: "x" },
  cancelled: { label: "Cancelled", tone: "neutral", icon: "x" },
  not_collected: { label: "Not collected", tone: "neutral", icon: "x" },
}

/** Where a shop's order is, as its staff read it in the vendor app. */
export const staffStatus = (state: FulfilmentState): StatusChipView => STATES[state]

/**
 * A new order's accept clock (ISO 8601 `deadline`) as a chip: sun while the shop has time, ember
 * in the last two open hours, when the reminder push goes, and once it is overdue.
 */
export function acceptClockStatus(deadline: string, now: Date): StatusChipView {
  const left = acceptTimeLeft(deadline, now)
  return { label: left.label, tone: left.urgent ? "attention" : "new", icon: "clock" }
}
