import type { Fulfilment } from "./fulfilment"

/**
 * How long one half of a handover (the staff tap, or the courier's pickup) may wait for the
 * other before the shop's owner is alerted (#25, docs/design.md "Order state machine").
 */
export const HANDOVER_DISAGREEMENT_MS = 2 * 60 * 60 * 1000

/** Whose half of the handover is missing, and since when (ISO 8601) the other half has waited. */
export type HandoverDisagreement = { waiting_for: "staff" | "courier"; since: string }

/**
 * Whether staff and the courier have disagreed about the handover for too long at `now`: one
 * half recorded at least `HANDOVER_DISAGREEMENT_MS` ago and the other still missing. Null otherwise.
 */
export function handoverDisagreement(fulfilment: Fulfilment, now: Date): HandoverDisagreement | null {
  if (fulfilment.state !== "courier_confirmed") return null
  const { staff, pickup } = fulfilment.handover
  if (staff && pickup) return null
  let disagreement: HandoverDisagreement | null = null
  if (staff) disagreement = { waiting_for: "courier", since: staff.at }
  else if (pickup) disagreement = { waiting_for: "staff", since: pickup.at }
  if (!disagreement) return null
  return now.getTime() - new Date(disagreement.since).getTime() >= HANDOVER_DISAGREEMENT_MS ? disagreement : null
}

/** How long after alerting the owner about a handover still in dispute they are alerted again. */
export const HANDOVER_REALERT_MS = 24 * 60 * 60 * 1000

/**
 * Whether to alert the shop's owner about the handover at `now`: the halves disagree
 * (`handoverDisagreement`) and the owner hasn't been alerted, or was last alerted
 * (`alertedAt`, ISO 8601) at least `HANDOVER_REALERT_MS` ago. Repeated daily so a delivered
 * order can't wait unpaid on a missed push.
 */
export function handoverAlertDue(fulfilment: Fulfilment, alertedAt: string | null, now: Date): HandoverDisagreement | null {
  const disagreement = handoverDisagreement(fulfilment, now)
  if (!disagreement || !alertedAt) return disagreement
  return now.getTime() - new Date(alertedAt).getTime() >= HANDOVER_REALERT_MS ? disagreement : null
}
