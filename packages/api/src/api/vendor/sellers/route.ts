import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { SellerStatus, type HttpTypes, type SellerDTO, type SellerMemberDTO } from "@mercurjs/types"

// Mercur's own, re-exported so the typed route map (codegen reads this file for the path) still has it.
export { POST } from "@mercurjs/core/api/vendor/sellers/route"

/** A shop the member belongs to, with its city: its pickup address's LGA or city (ADR 0002). */
export type VendorShopMembership = Omit<SellerMemberDTO, "seller"> & { seller: SellerDTO & { city: string | null } }

export type VendorShopMembershipListResponse = Omit<HttpTypes.VendorSellerMemberListResponse, "seller_members"> & {
  seller_members: VendorShopMembership[]
}

/**
 * Replaces Mercur's `GET /vendor/sellers` (its query config still applies): the shops the
 * signed-in member belongs to, as Mercur lists them, each with its city for the shop picker (#70).
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<VendorShopMembershipListResponse>) => {
  const memberId = req.auth_context?.actor_id
  if (!memberId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "You must be authenticated to access seller information.")
  }
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data, metadata } = await query.graph({
    entity: "seller_member",
    fields: req.queryConfig.fields,
    filters: { member_id: memberId, seller: { status: { $ne: SellerStatus.TERMINATED } } },
    pagination: req.queryConfig.pagination,
  })
  const members = data as unknown as SellerMemberDTO[]
  const cities = await citiesOf(req, members.map((m) => m.seller_id))
  const seller_members = members.map((m) => ({ ...m, seller: { ...m.seller, city: cities.get(m.seller_id) ?? null } }))
  res.json({ seller_members, count: metadata!.count, offset: metadata!.skip, limit: metadata!.take })
}

/** Each shop's city, by seller id. */
async function citiesOf(req: AuthenticatedMedusaRequest, sellerIds: string[]): Promise<Map<string, string | null>> {
  if (!sellerIds.length) return new Map()
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "seller", fields: ["id", "address.city"], filters: { id: sellerIds } })
  return new Map(
    (data as unknown as { id: string; address?: { city?: string | null } | null }[]).map((s) => [s.id, s.address?.city ?? null])
  )
}
