import type { MedusaResponse } from "@medusajs/framework/http"
import { setCollectionPoint, vendorCollectionPoint, type VendorCollectionPoint } from "../../../lib/collection-point"
import { sellerOf, type VendorRequest } from "../offer-import/seller"
import type { VendorSetCollectionPointType } from "./validators"

export type VendorCollectionPointResponse = VendorCollectionPoint

/** Where the shop's buyers collect pickup orders, if it offers pickup, and whether it has the hours to (#12). */
export const GET = async (req: VendorRequest, res: MedusaResponse<VendorCollectionPointResponse>) => {
  res.json(await vendorCollectionPoint(req.scope, sellerOf(req)))
}

/**
 * Sets the shop's collection point, and so offers its buyers pickup: the pickup address
 * (followed as it changes) or a separate pinned address, with instructions for buyers. Refused
 * for a shop without opening hours.
 */
export const POST = async (req: VendorRequest<VendorSetCollectionPointType>, res: MedusaResponse<VendorCollectionPointResponse>) => {
  res.json(await setCollectionPoint(req.scope, sellerOf(req), req.validatedBody))
}
