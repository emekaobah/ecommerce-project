import { z } from "zod"
import { VendorSavePickupAddress } from "../onboarding/validators"

/**
 * A collection point: the pickup address (`follows_pickup_address`), or a separate address in
 * the pickup address's shape, pinned on the map; always with instructions for buyers.
 */
export const VendorSetCollectionPoint = z.object({
  follows_pickup_address: z.boolean(),
  address: VendorSavePickupAddress.nullish(),
  instructions: z.string().trim().min(1, "Tell buyers how to collect").max(500),
  phone: z.string().trim().nullish(),
})
export type VendorSetCollectionPointType = z.infer<typeof VendorSetCollectionPoint>
