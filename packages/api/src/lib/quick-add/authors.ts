import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { QUICK_ADD_METADATA } from "./quick-add"

type Scope = Pick<MedusaContainer, "resolve">

/** Who added one of the shop's offers, so an owner can review what staff quick-added (#38). */
export type OfferAuthor = {
  offer_id: string
  /** The shop's SKU, which tells its offers on one product apart. */
  sku: string
  /** `quick_add` when a member added it by scanning in the vendor app; null otherwise. */
  added_with: "quick_add" | null
  /** The member who created it; null if they are no longer known. */
  added_by: { id: string; name: string | null; email: string } | null
  added_at: string
}

type OfferRow = { id: string; sku: string; created_by: string; created_at: string | Date; metadata: Record<string, unknown> | null }
type MemberRow = { id: string; email: string; first_name: string | null; last_name: string | null }

/** Who added each of the shop's offers on the product, oldest first. */
export async function loadOfferAuthors(scope: Scope, sellerId: string, productId: string): Promise<OfferAuthor[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "offer",
    fields: ["id", "sku", "created_by", "created_at", "metadata"],
    filters: { seller_id: sellerId, product_id: productId },
  })
  const offers = data as OfferRow[]
  const memberIds = [...new Set(offers.map((o) => o.created_by).filter(Boolean))]
  const { data: members } = memberIds.length
    ? await query.graph({ entity: "member", fields: ["id", "email", "first_name", "last_name"], filters: { id: memberIds } })
    : { data: [] }
  const memberById = new Map((members as MemberRow[]).map((m) => [m.id, m]))
  return offers
    .map((offer) => {
      const member = memberById.get(offer.created_by)
      const name = [member?.first_name, member?.last_name].filter(Boolean).join(" ")
      return {
        offer_id: offer.id,
        sku: offer.sku,
        added_with: offer.metadata?.added_with === QUICK_ADD_METADATA.added_with ? QUICK_ADD_METADATA.added_with : null,
        added_by: member ? { id: member.id, name: name || null, email: member.email } : null,
        added_at: new Date(offer.created_at).toISOString(),
      }
    })
    .sort((a, b) => a.added_at.localeCompare(b.added_at))
}
