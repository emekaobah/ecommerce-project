import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"

const PLACE_THE_PIN = "Place the delivery pin on the map"

/** The pin the buyer confirmed on the map, in an address's metadata (ADR 0002). */
const Pinned = z.object(
  {
    latitude: z.number({ invalid_type_error: PLACE_THE_PIN, required_error: PLACE_THE_PIN }).min(-90).max(90),
    longitude: z.number({ invalid_type_error: PLACE_THE_PIN, required_error: PLACE_THE_PIN }).min(-180).max(180),
  },
  { invalid_type_error: PLACE_THE_PIN, required_error: PLACE_THE_PIN }
)

/**
 * A saved delivery address (#18) is one checkout can deliver to, so it carries the pin the
 * buyer confirmed. Saving one needs the pin; an edit that sends metadata sends the pin with it
 * (Medusa merges metadata, and an empty value would remove it). Making an address the default
 * changes no metadata and passes. Medusa's own route validates the rest of the address.
 */
export function savedAddressesNeedPins(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  const body = (req.body ?? {}) as { metadata?: unknown }
  const creating = !req.params.address_id
  if (creating || body.metadata !== undefined) {
    const pinned = Pinned.safeParse(body.metadata)
    if (!pinned.success) {
      return next(new MedusaError(MedusaError.Types.INVALID_DATA, pinned.error.issues[0]?.message ?? PLACE_THE_PIN))
    }
  }
  next()
}
