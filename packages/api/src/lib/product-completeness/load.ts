import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules, ProductStatus } from "@medusajs/framework/utils"
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
  variants?: { id: string; weight: number | string | null; price_set?: { id: string } | null }[] | null
}


/**
 * Reads what the publish rule needs for each product. Attribute values and
 * prices are fetched separately: Mercur notes that mixing attribute-value links
 * with nested product-module relations in one graph query is unreliable.
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
      "variants.price_set.id",
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
      ;(byAttribute[attributeId] ??= []).push(value.id)
    }
    attributeValuesByProduct.set(row.id, byAttribute)
  }

  const priceSetIds = (products as ProductRow[]).flatMap((p) =>
    (p.variants ?? []).map((v) => v.price_set?.id).filter((id): id is string => !!id)
  )
  const prices = priceSetIds.length
    ? await scope.resolve(Modules.PRICING).listPrices({ price_set_id: priceSetIds })
    : []
  const amountsByPriceSet = new Map<string, number[]>()
  for (const price of prices) {
    const priceSetId = (price as { price_set_id?: string }).price_set_id
    if (!priceSetId) continue
    amountsByPriceSet.set(priceSetId, [...(amountsByPriceSet.get(priceSetId) ?? []), Number(price.amount)])
  }

  return (products as ProductRow[]).map((p) => ({
    id: p.id,
    status: p.status,
    title: p.title,
    image_count: (p.images ?? []).length,
    has_thumbnail: !!p.thumbnail,
    category_ids: (p.categories ?? []).map((c) => c.id),
    weight: toNumber(p.weight),
    variants: (p.variants ?? []).map((v) => ({
      id: v.id,
      weight: toNumber(v.weight),
      price_amounts: v.price_set ? amountsByPriceSet.get(v.price_set.id) ?? [] : [],
    })),
    attribute_values: attributeValuesByProduct.get(p.id) ?? {},
  }))
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
    category_ids: (Array.isArray(a.categories) ? a.categories : a.categories ? [a.categories] : [])
      .map((c: any) => c?.id)
      .filter(Boolean),
  }))
}

export async function getProductsCompleteness(scope: Scope, productIds: string[]): Promise<ProductCompleteness[]> {
  const [facts, required] = await Promise.all([loadProductFacts(scope, productIds), loadRequiredAttributes(scope)])
  return facts.map((f) => assessProductCompleteness(f, required))
}

export async function getProductCompleteness(scope: Scope, productId: string): Promise<ProductCompleteness> {
  const [report] = await getProductsCompleteness(scope, [productId])
  if (!report) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product with id ${productId} was not found`)
  }
  return report
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
  const facts = stored
    .map((f) => withPendingActions(f, options.pending?.get(f.id) ?? []))
    .filter((f) => !options.onlyIfPublished || f.status === ProductStatus.PUBLISHED)
  refuse(
    facts,
    facts.map((f) => assessProductCompleteness(f, required))
  )
}
