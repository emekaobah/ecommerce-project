import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Per-category shipping defaults, stored on the category as
 * `metadata.shipping_defaults`. Grams and centimetres; `package_category` is the
 * parcel class couriers quote on.
 */
export type ShippingDefaults = {
  weight?: number
  length?: number
  width?: number
  height?: number
  package_category?: string
}

const DIMENSIONS = ["weight", "length", "width", "height"] as const

type ProductRow = {
  id: string
  weight: number | string | null
  length: number | string | null
  width: number | string | null
  height: number | string | null
  metadata: Record<string, unknown> | null
  categories?: { id: string; rank?: number; metadata?: Record<string, unknown> | null }[] | null
}

const isBlank = (v: unknown) => v === null || v === undefined || v === "" || Number(v) === 0

/**
 * Fills a newly created product's missing weight, dimensions and package
 * category from its category's shipping defaults. Values the product was created
 * with win, and every field stays editable afterwards (vendor-overridable).
 */
export async function applyCategoryShippingDefaults(
  scope: Pick<MedusaContainer, "resolve">,
  productIds: string[]
): Promise<void> {
  if (!productIds.length) return
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "weight", "length", "width", "height", "metadata", "categories.id", "categories.metadata"],
    filters: { id: productIds },
  })

  const productService = scope.resolve(Modules.PRODUCT)
  for (const product of data as ProductRow[]) {
    const defaults = (product.categories ?? [])
      .map((c) => c.metadata?.shipping_defaults as ShippingDefaults | undefined)
      .find((d) => d && typeof d === "object")
    if (!defaults) continue

    const update: Record<string, unknown> = {}
    for (const field of DIMENSIONS) {
      if (isBlank(product[field]) && typeof defaults[field] === "number") update[field] = defaults[field]
    }
    if (defaults.package_category && !product.metadata?.package_category) {
      update.metadata = { ...product.metadata, package_category: defaults.package_category }
    }
    if (Object.keys(update).length) {
      await productService.updateProducts(product.id, update)
    }
  }
}
