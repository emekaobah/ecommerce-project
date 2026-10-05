import { pickProgress, type PickLine, type PickProgress } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { fulfilmentsOf } from "./order-fulfilment"

// Staff pick an accepted order against a checklist of its lines, and pack it once every line
// is picked in full (#21). Each line's picked count is kept on the order's fulfilment row, so
// the checklist survives leaving the screen, and another phone sees the same progress.

type Scope = Pick<MedusaContainer, "resolve">

/** One line of the checklist: what to fetch from the shelf, how many, and the barcodes to scan. */
export type PickListLine = PickLine & {
  product_title: string | null
  variant_title: string | null
  thumbnail: string | null
}

export type PickList = { lines: PickListLine[]; progress: PickProgress }

export type VendorPickListResponse = { pick_list: PickList }

type ItemRow = {
  id: string
  quantity: number
  product_title: string | null
  variant_title: string | null
  thumbnail: string | null
  variant_id: string | null
  variant_barcode: string | null
}

type VariantRow = { id: string; barcode: string | null; ean: string | null; upc: string | null }

/** The order's checklist, with what has been picked so far. */
export async function pickListOf(scope: Scope, orderId: string): Promise<PickList> {
  const [items, record] = await Promise.all([itemsOf(scope, orderId), fulfilmentsOf(scope, [orderId])])
  const picks = record.get(orderId)?.picks ?? {}
  const variants = await variantsOf(
    scope,
    items.map((item) => item.variant_id).filter((id): id is string => !!id)
  )
  const lines = items.map((item): PickListLine => {
    const variant = item.variant_id ? variants.get(item.variant_id) : undefined
    // The variant's codes now, or the barcode the line kept when ordered if the variant is gone.
    const codes = variant ? [variant.barcode, variant.ean, variant.upc] : [item.variant_barcode]
    return {
      id: item.id,
      product_title: item.product_title,
      variant_title: item.variant_title,
      thumbnail: item.thumbnail,
      quantity: item.quantity,
      picked: picks[item.id] ?? 0,
      codes: [...new Set(codes.filter((c): c is string => !!c))],
    }
  })
  return { lines, progress: pickProgress(lines) }
}

/** The order's line items; a 404 for an order that doesn't exist. */
export async function itemsOf(scope: Scope, orderId: string): Promise<ItemRow[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "items.id",
      "items.detail.quantity",
      "items.product_title",
      "items.variant_title",
      "items.thumbnail",
      "items.variant_id",
      "items.variant_barcode",
    ],
    filters: { id: orderId },
  })
  if (!data[0]) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order with id: ${orderId} was not found`)
  type Row = Omit<ItemRow, "quantity"> & { detail?: { quantity: number | string } | null }
  // An order line's quantity is on its detail (the order item), which an order edit changes.
  return ((data[0].items ?? []) as (Row | null)[])
    .filter((item): item is Row => !!item)
    .map(({ detail, ...item }) => ({ ...item, quantity: Number(detail?.quantity ?? 0) }))
}

async function variantsOf(scope: Scope, ids: string[]): Promise<Map<string, VariantRow>> {
  if (!ids.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: ["id", "barcode", "ean", "upc"],
    filters: { id: ids },
  })
  return new Map((data as VariantRow[]).map((v) => [v.id, v]))
}
