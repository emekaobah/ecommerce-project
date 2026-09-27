import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, ProductStatus } from "@medusajs/framework/utils"
import { ProductChangeActionType } from "@mercurjs/types"
import {
  findPendingChange,
  getProductCompleteness,
  type ProductCompleteness,
} from "../../../../../lib/product-completeness"

type VendorRequest = AuthenticatedMedusaRequest & { seller_context?: { seller_id: string } }

/**
 * Mirrors Mercur's vendor product visibility: a seller sees the products it
 * submitted, plus published products not restricted to other sellers.
 */
async function isVisibleToSeller(req: VendorRequest, productId: string, sellerId: string): Promise<boolean> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: submitted } = await query.graph({
    entity: "product_change_action",
    fields: ["id"],
    filters: {
      product_id: productId,
      action: ProductChangeActionType.PRODUCT_ADD,
      product_change: { created_by: sellerId },
    } as any,
  })
  if (submitted.length) return true

  const { data: [product] } = await query.graph({ entity: "product", fields: ["status"], filters: { id: productId } })
  if (product?.status !== ProductStatus.PUBLISHED) return false

  const { data: eligibility } = await query.graph({
    entity: "product_seller",
    fields: ["seller_id"],
    filters: { product_id: productId } as any,
  })
  return !eligibility.length || eligibility.some((link: { seller_id: string }) => link.seller_id === sellerId)
}

type VendorCompletenessResponse = {
  completeness: ProductCompleteness
  /** The seller's open change request, when the completeness reflects it. */
  pending_change: { id: string } | null
}

/**
 * A product's completeness score and what it still needs before it can be
 * published. While the seller has a change request pending on the product, the
 * report is for the product as that request would leave it.
 */
export async function GET(req: VendorRequest, res: MedusaResponse<VendorCompletenessResponse>) {
  const sellerId = req.seller_context?.seller_id
  if (!sellerId || !(await isVisibleToSeller(req, req.params.id, sellerId))) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product with id ${req.params.id} was not found`)
  }
  const pending = await findPendingChange(req.scope, req.params.id, sellerId)
  const completeness = await getProductCompleteness(req.scope, req.params.id, pending?.actions)
  res.json({ completeness, pending_change: pending ? { id: pending.id } : null })
}
