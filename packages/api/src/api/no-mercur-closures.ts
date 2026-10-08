import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

/** Mercur's seller closure fields, which our shop-hours module replaces (ADR 0004). */
const CLOSURE_FIELDS = ["closed_from", "closed_to", "closure_note"]

/**
 * Mercur's vendor and admin seller routes take closure dates, which would hide the shop from
 * Mercur's store routes while ours showed it open. Our shop-hours module is the only source of
 * truth for closures (ADR 0004), so a write carrying any of them is refused (400) before it is saved.
 */
export function refuseMercurClosures(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  const body = (req.body ?? {}) as Record<string, unknown>
  const sent = CLOSURE_FIELDS.filter((field) => field in body)
  if (!sent.length) return next()
  next(
    new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Shop closures are set with the shop's hours, exceptions and pauses, not ${sent.join(", ")}.`
    )
  )
}
