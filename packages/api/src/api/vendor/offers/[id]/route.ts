import type { MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { updateOfferWorkflow, type UpdateOfferInput } from "../../../../workflows/offer-prices/update-offer"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"

// Mercur's own, re-exported so the typed route map (codegen reads this file for the path) still has them.
export { GET, DELETE } from "@mercurjs/core/api/vendor/offers/[id]/route"

type UpdateOfferBody = Omit<UpdateOfferInput["offer"], "id"> & { additional_data?: Record<string, unknown> }

/**
 * Replaces Mercur's `POST /vendor/offers/:id` (Mercur's body validation and RBAC policy
 * for this route still apply). Mercur's handler rewrites the
 * variant's whole shared price set, deleting other shops' prices for it (#84); this one
 * writes only the shop's own offer's prices.
 */
export const POST = async (req: VendorRequest<UpdateOfferBody>, res: MedusaResponse) => {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [own] } = await query.graph({ entity: "offer", fields: ["id"], filters: { id, seller_id: sellerOf(req) } })
  if (!own) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Offer with id: ${id} was not found`)

  const { additional_data, ...update } = req.validatedBody
  await updateOfferWorkflow(req.scope).run({ input: { offer: { id, ...update }, additional_data } })

  const { data: [offer] } = await query.graph({ entity: "offer", fields: req.queryConfig.fields, filters: { id } })
  res.json({ offer })
}
