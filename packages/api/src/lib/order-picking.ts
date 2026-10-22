import { pickProgress, type PickLine, type PickProgress } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN, MedusaError } from "@medusajs/framework/utils"
import { fulfilmentsOf, type Picks } from "./order-fulfilment"

// Staff pick an accepted order against a checklist of its lines, and pack it once every line
// is picked in full (#21). Each line's picked count is kept on the order's fulfilment row, so
// the checklist survives leaving the screen, and another phone sees the same progress.
//
// Units the shop doesn't have are marked unavailable (#22), kept on the row the same way until
// staff remove them from the order, which refunds the buyer for them.

type Scope = Pick<MedusaContainer, "resolve">

/** One line of the checklist: what to fetch from the shelf, how many, and the barcodes to scan. */
export type PickListLine = PickLine & {
  product_title: string | null
  variant_title: string | null
  thumbnail: string | null
}

export type PickList = {
  lines: PickListLine[]
  progress: PickProgress
  currency_code: string
  /** What the units marked unavailable cost the buyer: the refund once they are removed. */
  unavailable_amount: number
}

export type VendorPickListResponse = { pick_list: PickList }

type ItemRow = {
  id: string
  quantity: number
  /** The line's total for its quantity, with its tax and discounts. */
  total: number
  product_title: string | null
  variant_title: string | null
  thumbnail: string | null
  variant_id: string | null
  variant_barcode: string | null
}

type VariantRow = { id: string; barcode: string | null; ean: string | null; upc: string | null }

/** The order's checklist, with what has been picked and marked unavailable so far. */
export async function pickListOf(scope: Scope, orderId: string): Promise<PickList> {
  const [{ currency_code, items: all }, record] = await Promise.all([orderItemsOf(scope, orderId), fulfilmentsOf(scope, [orderId])])
  const row = record.get(orderId)
  const picks = row?.picks ?? {}
  const unavailable = row?.unavailable ?? {}
  // A line removed in full is no longer on the order to pick.
  const items = all.filter((item) => item.quantity > 0)
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
      unavailable: unavailable[item.id] ?? 0,
      codes: [...new Set(codes.filter((c): c is string => !!c))],
    }
  })
  return {
    lines,
    progress: pickProgress(lines),
    currency_code,
    unavailable_amount: removalAmount(items, unavailable),
  }
}

/** The note on the order edit and refund that remove units marked unavailable. */
export const UNAVAILABLE_NOTE = "Items unavailable at picking"

/** The states an order is picked in: picking, and partially available while units wait to be removed (#22). */
export const PICKING_STATES = new Set(["picking", "partially_available"])

/** The order's fulfilment row and one of its lines, while the order is being picked; refuses any other. */
export async function lineBeingPicked(scope: Scope, orderId: string, itemId: string) {
  const record = (await fulfilmentsOf(scope, [orderId])).get(orderId)
  if (!record) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${orderId} isn't being picked`)
  if (!PICKING_STATES.has(record.state)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${orderId} is ${record.state.replaceAll("_", " ")}: it isn't being picked`)
  }
  // A line removed in full is no longer on the order.
  const item = (await itemsOf(scope, orderId)).find((i) => i.id === itemId && i.quantity > 0)
  if (!item) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} has no line ${itemId}`)
  return { record, item }
}

/** What removing these units takes off the lines' totals: each unit at its share of its line's total. */
function removalAmount(items: Pick<ItemRow, "id" | "quantity" | "total">[], units: Record<string, number>): number {
  const amount = items.reduce((sum, item) => {
    const count = units[item.id] ?? 0
    if (!count || !item.quantity) return sum
    return MathBN.add(sum, MathBN.div(MathBN.mult(item.total, count), item.quantity))
  }, MathBN.convert(0))
  return MathBN.convert(amount).toNumber()
}

/** Each line still on the order and how many of it: what refunding a rejected or cancelled order is for (#61). */
export async function unitsOnOrder(scope: Scope, orderId: string): Promise<Picks> {
  return Object.fromEntries((await itemsOf(scope, orderId)).filter((i) => i.quantity > 0).map((i) => [i.id, i.quantity]))
}

/** The order's line items; a 404 for an order that doesn't exist. */
export async function itemsOf(scope: Scope, orderId: string): Promise<ItemRow[]> {
  return (await orderItemsOf(scope, orderId)).items
}

async function orderItemsOf(scope: Scope, orderId: string): Promise<{ currency_code: string; items: ItemRow[] }> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "currency_code",
      // The order module works out its lines' totals only when the order's total is asked for.
      "total",
      "items.id",
      "items.detail.quantity",
      "items.total",
      "items.product_title",
      "items.variant_title",
      "items.thumbnail",
      "items.variant_id",
      "items.variant_barcode",
    ],
    filters: { id: orderId },
  })
  if (!data[0]) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order with id: ${orderId} was not found`)
  type Row = Omit<ItemRow, "quantity" | "total"> & { total: unknown; detail?: { quantity: number | string } | null }
  // An order line's quantity is on its detail (the order item), which an order edit changes.
  const items = ((data[0].items ?? []) as (Row | null)[])
    .filter((item): item is Row => !!item)
    .map(({ detail, total, ...item }) => ({ ...item, quantity: Number(detail?.quantity ?? 0), total: Number(total ?? 0) }))
  return { currency_code: data[0].currency_code as string, items }
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
