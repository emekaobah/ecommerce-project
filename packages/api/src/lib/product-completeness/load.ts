import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, ProductStatus } from "@medusajs/framework/utils"
import { ProductChangeStatus } from "@mercurjs/types"
import { loadCategoryDefaults } from "../shipping-defaults"
import {
  assessProductCompleteness,
  toNumber,
  withPendingActions,
  type PendingAction,
  type ProductCompleteness,
  type ProductFacts,
  type RequiredAttribute,
} from "./assess"

type Scope = Pick<MedusaContainer, "resolve">

type ProductRow = {
  id: string
  status: string
  title: string | null
  thumbnail: string | null
  weight: number | string | null
  images?: { id: string }[] | null
  categories?: { id: string }[] | null
  variants?: { id: string; weight: number | string | null }[] | null
}


/**
 * Reads what the publish rule needs for each product. Attribute values are
 * fetched separately: Mercur notes that mixing attribute-value links with nested
 * product-module relations in one graph query is unreliable.
 */
export async function loadProductFacts(scope: Scope, productIds: string[]): Promise<ProductFacts[]> {
  if (!productIds.length) return []
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "status",
      "title",
      "thumbnail",
      "weight",
      "images.id",
      "categories.id",
      "variants.id",
      "variants.weight",
    ],
    filters: { id: productIds },
  })

  const { data: attributeRows } = await query.graph({
    entity: "product",
    fields: ["id", "product_attribute_values.id", "product_attribute_values.attribute.id"],
    filters: { id: productIds },
  })
  const attributeValuesByProduct = new Map<string, Record<string, string[]>>()
  for (const row of attributeRows as any[]) {
    const byAttribute: Record<string, string[]> = {}
    for (const value of row.product_attribute_values ?? []) {
      const attributeId = value?.attribute?.id
      if (!attributeId) continue
      const values = byAttribute[attributeId] ?? []
      values.push(value.id)
      byAttribute[attributeId] = values
    }
    attributeValuesByProduct.set(row.id, byAttribute)
  }

  return (products as ProductRow[]).map((p) => ({
    id: p.id,
    status: p.status,
    title: p.title,
    image_count: (p.images ?? []).length,
    has_thumbnail: !!p.thumbnail,
    category_ids: (p.categories ?? []).map((c) => c.id),
    weight: toNumber(p.weight),
    variants: (p.variants ?? []).map((v) => ({ id: v.id, weight: toNumber(v.weight) })),
    attribute_values: attributeValuesByProduct.get(p.id) ?? {},
  }))
}

/** A link Query may return as one object or a list, as a list. */
function asList<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  return value ? [value] : []
}

/** Active, global attributes marked required, with the categories they apply to. */
export async function loadRequiredAttributes(scope: Scope): Promise<RequiredAttribute[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_attribute",
    fields: ["id", "name", "categories.id"],
    filters: { is_required: true, is_active: true, product_id: null } as any,
  })
  return (data as any[]).map((a) => ({
    id: a.id,
    name: a.name,
    category_ids: asList(a.categories)
      .map((c: any) => c?.id)
      .filter(Boolean),
  }))
}

/**
 * Pending edits applied on top of the stored products, with a blank weight then
 * taken from the (possibly new) categories' shipping defaults, as the save that
 * applies the edits will do.
 */
async function projectedFacts(
  scope: Scope,
  stored: ProductFacts[],
  pending?: Map<string, PendingAction[]>
): Promise<ProductFacts[]> {
  return Promise.all(
    stored.map(async (f) => {
      const actions = pending?.get(f.id)
      if (!actions?.length) return f
      const projected = withPendingActions(f, actions)
      if (!(projected.weight && projected.weight > 0)) {
        const defaults = await loadCategoryDefaults(scope, projected.category_ids)
        if (typeof defaults?.weight === "number") projected.weight = defaults.weight
      }
      return projected
    })
  )
}

export async function getProductsCompleteness(
  scope: Scope,
  productIds: string[],
  pending?: Map<string, PendingAction[]>
): Promise<ProductCompleteness[]> {
  const [stored, required] = await Promise.all([loadProductFacts(scope, productIds), loadRequiredAttributes(scope)])
  const facts = await projectedFacts(scope, stored, pending)
  return facts.map((f) => assessProductCompleteness(f, required))
}

/**
 * A product's completeness, as stored or, given its pending edits, as those edits
 * would leave it.
 */
export async function getProductCompleteness(
  scope: Scope,
  productId: string,
  pendingActions?: PendingAction[]
): Promise<ProductCompleteness> {
  const pending = pendingActions ? new Map([[productId, pendingActions]]) : undefined
  const [report] = await getProductsCompleteness(scope, [productId], pending)
  if (!report) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product with id ${productId} was not found`)
  }
  return report
}

/**
 * Unapplied actions of the given product changes, grouped by product in the
 * order they will apply.
 */
export async function loadPendingActions(scope: Scope, changeIds: string[]): Promise<Map<string, PendingAction[]>> {
  const pending = new Map<string, PendingAction[]>()
  if (!changeIds.length) return pending
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "product_change_action",
    fields: ["product_id", "action", "details", "ordering"],
    filters: { product_change_id: changeIds, applied: false } as any,
  })
  // The product module types `ordering` as a string; it holds a number.
  const rows = (data as (PendingAction & { product_id: string; ordering: number | string })[]).sort(
    (a, b) => Number(a.ordering) - Number(b.ordering)
  )
  for (const row of rows) {
    pending.set(row.product_id, [...(pending.get(row.product_id) ?? []), row])
  }
  return pending
}

/** The pending change request a seller has open on a product, if any. */
export async function findPendingChange(
  scope: Scope,
  productId: string,
  createdBy: string
): Promise<{ id: string; actions: PendingAction[] } | null> {
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "product_change",
    fields: ["id"],
    filters: { product_id: productId, created_by: createdBy, status: ProductChangeStatus.PENDING } as any,
  })
  const change = data[0] as { id: string } | undefined
  if (!change) return null
  const pending = await loadPendingActions(scope, [change.id])
  return { id: change.id, actions: pending.get(productId) ?? [] }
}

/** Throws a 400 naming each incomplete product and what it is missing. */
function refuse(facts: ProductFacts[], reports: ProductCompleteness[]): void {
  const incomplete = reports.filter((r) => !r.is_complete)
  if (!incomplete.length) return
  const titleById = new Map(facts.map((f) => [f.id, f.title]))
  const lines = incomplete.map((r) => {
    const name = titleById.get(r.product_id)?.trim() || r.product_id
    return `"${name}" is missing: ${r.missing.map((m) => m.label).join(", ")}`
  })
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `Product cannot be published until it is complete. ${lines.join("; ")}.`
  )
}

/**
 * The publish gate: refuses with the missing fields listed unless every given
 * product is complete. `pending` edits, keyed by product, are applied on top of
 * the stored product first, and only products that end up published are checked,
 * so an edit can be refused before anything is written.
 */
export async function assertPublishable(
  scope: Scope,
  productIds: string[],
  options: { pending?: Map<string, PendingAction[]>; onlyIfPublished?: boolean } = {}
): Promise<void> {
  if (!productIds.length) return
  const [stored, required] = await Promise.all([loadProductFacts(scope, productIds), loadRequiredAttributes(scope)])
  const facts = (await projectedFacts(scope, stored, options.pending)).filter(
    (f) => !options.onlyIfPublished || f.status === ProductStatus.PUBLISHED
  )
  refuse(
    facts,
    facts.map((f) => assessProductCompleteness(f, required))
  )
}
