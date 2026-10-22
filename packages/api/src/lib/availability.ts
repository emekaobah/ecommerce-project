import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { availableQuantity } from "@oja/domain"

// How many of each offer can still be sold, read from the offer's stock links (`@oja/domain`'s
// `availableQuantity`): listings, the product, Home's shops and the cart show it, and fixing a
// paid cart that wasn't placed cuts lines to it.

type Scope = Pick<MedusaContainer, "resolve">

type OfferStockRow = {
  id: string
  manage_inventory: boolean | null
  allow_backorder: boolean | null
  inventory_item_link?:
    | {
        required_quantity: number | null
        inventory_item?: { location_levels?: { stocked_quantity: number; reserved_quantity: number }[] | null } | null
      }[]
    | null
}

/**
 * How many of each offer can still be sold, by offer id; null for an offer whose stock isn't
 * tracked or that allows backorders. An offer that no longer exists has no entry.
 */
export async function availableQuantities(scope: Scope, offerIds: string[]): Promise<Map<string, number | null>> {
  if (!offerIds.length) return new Map()
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "offer",
    fields: [
      "id",
      "manage_inventory",
      "allow_backorder",
      "inventory_item_link.required_quantity",
      "inventory_item_link.inventory_item.location_levels.stocked_quantity",
      "inventory_item_link.inventory_item.location_levels.reserved_quantity",
    ],
    filters: { id: [...new Set(offerIds)] },
  })
  return new Map(
    (data as unknown as OfferStockRow[]).map((offer) => [
      offer.id,
      availableQuantity({
        manage_inventory: offer.manage_inventory,
        allow_backorder: offer.allow_backorder,
        parts: (offer.inventory_item_link ?? []).map((link) => ({
          required_quantity: link.required_quantity,
          levels: link.inventory_item?.location_levels ?? [],
        })),
      }),
    ])
  )
}
