import type { TimelineStep } from "./timeline"

/** A step of the handover timeline, with the line under its label ("Tap when the rider takes the parcel"). */
export type HandoverStep = TimelineStep & { detail: string | null }

/** What the vendor order view says of a booked courier, its handover and its staff timeline. */
export type HandoverView = {
  shipment: { courier_name: string } | null
  /** Null until the courier confirms the pickup; then each half once it arrives. */
  handover: { staff: { name: string | null; at: string } | null; picked_up_at: string | null } | null
  timeline: TimelineStep[]
}

const reachedAt = (timeline: TimelineStep[], label: string) => timeline.find((step) => step.label === label)?.at ?? null

/**
 * A delivery order's handover as staff see it from its label being booked (#25): Label booked,
 * Courier confirmed, then its two halves, the staff tap (Handed to courier) and the courier's
 * Picked up. Either half may arrive first; the one still missing is current once the other is
 * done, and the staff tap is current while neither has arrived.
 */
export function handoverSteps({ shipment, handover, timeline }: HandoverView): HandoverStep[] {
  const courier = shipment?.courier_name ?? "The courier"
  const staff = handover?.staff ?? null
  const pickedUpAt = handover?.picked_up_at ?? null
  const confirmed = handover !== null

  const halfStatus = (done: boolean, otherDone: boolean, first: boolean): TimelineStep["status"] => {
    if (done) return "done"
    if (!confirmed) return "upcoming"
    return otherDone || first ? "current" : "upcoming"
  }

  return [
    { label: "Label booked", status: "done", at: reachedAt(timeline, "Label booked"), detail: `${courier} · 1 parcel` },
    confirmed
      ? { label: "Courier confirmed", status: "done", at: reachedAt(timeline, "Courier confirmed"), detail: `${courier} accepted the pickup` }
      : { label: "Courier confirmed", status: "current", at: null, detail: `Waiting for ${courier} to accept the pickup` },
    {
      label: "Handed to courier",
      status: halfStatus(!!staff, !!pickedUpAt, true),
      at: staff?.at ?? null,
      detail: staff ? `By ${staff.name ?? "a staff member"}` : "Tap when the rider takes the parcel",
    },
    {
      label: "Picked up",
      status: halfStatus(!!pickedUpAt, !!staff, false),
      at: pickedUpAt,
      detail: pickedUpAt ? `${courier} confirmed the pickup` : `${courier} confirms on their side`,
    },
  ]
}
