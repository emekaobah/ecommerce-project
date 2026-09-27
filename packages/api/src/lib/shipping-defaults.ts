import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type Scope = Pick<MedusaContainer, "resolve">

/**
 * Per-category shipping defaults, stored on the category as
 * `metadata.shipping_defaults`. Grams and centimetres; `package_category` is the
 * parcel class couriers quote on.
 */
export type ShippingDefaults = {
  weight: number
  length: number
  width: number
  height: number
  package_category: string
}

const DIMENSIONS = ["weight", "length", "width", "height"] as const

type ProductRow = {
  id: string
  weight: number | string | null
  length: number | string | null
  width: number | string | null
  height: number | string | null
  metadata: Record<string, unknown> | null
  categories?: CategoryRow[] | null
}

type CategoryRow = { id: string; parent_category_id?: string | null; metadata?: Record<string, unknown> | null }

/** A product update that fills in what its category defaults provide. */
export type ShippingDefaultsUpdate = { id: string } & Partial<Record<(typeof DIMENSIONS)[number], number>> & {
    metadata?: Record<string, unknown>
  }

const isBlank = (v: unknown) => v === null || v === undefined || v === "" || Number(v) === 0

/**
 * The most specific category wins: a sub-category's defaults over its
 * department's, then by id so the choice is stable.
 */
function pickCategoryDefaults(categories: CategoryRow[]): Partial<ShippingDefaults> | undefined {
  return [...categories]
    .sort((a, b) => Number(!a.parent_category_id) - Number(!b.parent_category_id) || a.id.localeCompare(b.id))
    .map((c) => c.metadata?.shipping_defaults as Partial<ShippingDefaults> | undefined)
    .find((d) => !!d && typeof d === "object")
}

/** The shipping defaults the given categories give a product, if any. */
export async function loadCategoryDefaults(
  scope: Scope,
  categoryIds: string[]
): Promise<Partial<ShippingDefaults> | undefined> {
  if (!categoryIds.length) return undefined
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "product_category",
    fields: ["id", "parent_category_id", "metadata"],
    filters: { id: categoryIds },
  })
  return pickCategoryDefaults(data as CategoryRow[])
}

/**
 * Fills the given products' blank shipping fields from their categories and
 * returns what they held before, for `restoreShippingFields`.
 */
export async function applyCategoryShippingDefaults(scope: Scope, productIds: string[]): Promise<ShippingDefaultsUpdate[]> {
  const { updates, previous } = await planCategoryShippingDefaults(scope, productIds)
  if (updates.length) await scope.resolve(Modules.PRODUCT).upsertProducts(updates)
  return previous
}

export async function restoreShippingFields(scope: Scope, previous: ShippingDefaultsUpdate[] | undefined): Promise<void> {
  if (previous?.length) await scope.resolve(Modules.PRODUCT).upsertProducts(previous)
}

/**
 * Updates that fill products' missing weight, dimensions and
 * package category from their category's shipping defaults. Values a product was
 * created with win, and every field stays editable afterwards (vendor-overridable).
 * Returns the updates to apply and the previous values, for compensation.
 */
export async function planCategoryShippingDefaults(
  scope: Scope,
  productIds: string[]
): Promise<{ updates: ShippingDefaultsUpdate[]; previous: ShippingDefaultsUpdate[] }> {
  if (!productIds.length) return { updates: [], previous: [] }
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "weight",
      "length",
      "width",
      "height",
      "metadata",
      "categories.id",
      "categories.parent_category_id",
      "categories.metadata",
    ],
    filters: { id: productIds },
  })

  const updates: ShippingDefaultsUpdate[] = []
  const previous: ShippingDefaultsUpdate[] = []
  for (const product of data as ProductRow[]) {
    const planned = planProductDefaults(product)
    if (!planned) continue
    updates.push(planned.update)
    previous.push(planned.before)
  }
  return { updates, previous }
}

/** The fields one product takes from its categories' defaults, and their values before. */
function planProductDefaults(
  product: ProductRow
): { update: ShippingDefaultsUpdate; before: ShippingDefaultsUpdate } | undefined {
  const defaults = pickCategoryDefaults(product.categories ?? [])
  if (!defaults) return undefined

  const update: ShippingDefaultsUpdate = { id: product.id }
  const before: ShippingDefaultsUpdate = { id: product.id }
  for (const field of DIMENSIONS) {
    const value = defaults[field]
    if (isBlank(product[field]) && typeof value === "number") {
      update[field] = value
      before[field] = product[field] === null ? (null as unknown as number) : Number(product[field])
    }
  }
  if (defaults.package_category && !product.metadata?.package_category) {
    update.metadata = { ...product.metadata, package_category: defaults.package_category }
    before.metadata = product.metadata ?? {}
  }
  return Object.keys(update).length > 1 ? { update, before } : undefined
}
