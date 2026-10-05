import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { isPerishable } from "@oja/domain"
import { PERISHABLE_MODULE, type PerishableModuleService } from "../modules/perishable"

// Perishables (#69, docs/design.md → Perishables): the operator marks catalogue categories
// perishable, products inherit it (from their categories and those categories' parents), and
// the operator can override it per product either way. Shops can't change either: the flags
// live in our own module, written only by the admin routes.

type Scope = Pick<MedusaContainer, "resolve">

/** How a product stands: perishable or not, the operator's override if any, and what its categories say. */
export type ProductPerishable = { perishable: boolean; override: boolean | null; inherited: boolean }

/** A category's own flag, and whether a parent category makes it perishable anyway. */
export type CategoryPerishable = { perishable: boolean; inherited: boolean }

const perishableFlags = (scope: Scope) => scope.resolve<PerishableModuleService>(PERISHABLE_MODULE)

type CategoryRow = { id: string; mpath?: string | null; parent_category_id?: string | null }

/** A category and its parents up to the department: `mpath` lists them root first. */
const lineageOf = (category: CategoryRow) =>
  [...new Set([...(category.mpath?.split(".") ?? []), category.parent_category_id, category.id])].filter(
    (id): id is string => !!id
  )

/** The categories among `ids` the operator marked perishable. */
async function flaggedCategories(scope: Scope, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await perishableFlags(scope).listPerishableCategories({ category_id: ids, perishable: true })
  return new Set(rows.map((r) => r.category_id))
}

async function categoriesOf(scope: Scope, productIds: string[]) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "categories.id", "categories.mpath", "categories.parent_category_id"],
    filters: { id: productIds },
  })
  return data as { id: string; categories?: (CategoryRow | null)[] | null }[]
}

/** Each product's standing, by product id. Products that don't exist are left out. */
export async function productsPerishable(scope: Scope, productIds: string[]): Promise<Map<string, ProductPerishable>> {
  const ids = [...new Set(productIds)]
  if (!ids.length) return new Map()
  const [products, overrides] = await Promise.all([
    categoriesOf(scope, ids),
    perishableFlags(scope).listPerishableProducts({ product_id: ids }),
  ])
  const lineages = new Map(
    products.map((p) => [p.id, (p.categories ?? []).flatMap((c) => (c ? [lineageOf(c)] : []))] as const)
  )
  const flagged = await flaggedCategories(scope, [...new Set([...lineages.values()].flat(2))])
  const overrideOf = new Map(overrides.map((o) => [o.product_id, o.perishable]))
  return new Map(
    products.map((p) => {
      const categories = lineages.get(p.id)!.map((lineage) => lineage.some((id) => flagged.has(id)))
      const override = overrideOf.get(p.id) ?? null
      return [
        p.id,
        { perishable: isPerishable({ override, categories }), override, inherited: isPerishable({ override: null, categories }) },
      ]
    })
  )
}

/** The products among `productIds` that are perishable. */
export async function perishableProductIds(scope: Scope, productIds: string[]): Promise<Set<string>> {
  const standing = await productsPerishable(scope, productIds)
  return new Set([...standing].flatMap(([id, s]) => (s.perishable ? [id] : [])))
}

/** A product's standing, or not found. */
export async function productPerishable(scope: Scope, productId: string): Promise<ProductPerishable> {
  const standing = (await productsPerishable(scope, [productId])).get(productId)
  if (!standing) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product with id ${productId} was not found`)
  return standing
}

/** Sets or, with null, clears the operator's override of a product. */
export async function overrideProductPerishable(
  scope: Scope,
  productId: string,
  override: boolean | null
): Promise<ProductPerishable> {
  await productPerishable(scope, productId)
  const service = perishableFlags(scope)
  const [existing] = await service.listPerishableProducts({ product_id: productId })
  if (override === null) {
    if (existing) await service.deletePerishableProducts(existing.id)
  } else if (existing) {
    await service.updatePerishableProducts({ id: existing.id, perishable: override })
  } else {
    await service.createPerishableProducts({ product_id: productId, perishable: override })
  }
  return productPerishable(scope, productId)
}

async function categoryRow(scope: Scope, categoryId: string): Promise<CategoryRow> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_category",
    fields: ["id", "mpath", "parent_category_id"],
    filters: { id: categoryId },
  })
  const category = data[0] as CategoryRow | undefined
  if (!category) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product category with id ${categoryId} was not found`)
  return category
}

/** A category's own flag, and whether one of its parents makes it perishable, or not found. */
export async function categoryPerishable(scope: Scope, categoryId: string): Promise<CategoryPerishable> {
  const category = await categoryRow(scope, categoryId)
  const lineage = lineageOf(category)
  const flagged = await flaggedCategories(scope, lineage)
  return {
    perishable: flagged.has(category.id),
    inherited: lineage.some((id) => id !== category.id && flagged.has(id)),
  }
}

/** Marks a category perishable or not. */
export async function setCategoryPerishable(scope: Scope, categoryId: string, perishable: boolean): Promise<CategoryPerishable> {
  await categoryRow(scope, categoryId)
  const service = perishableFlags(scope)
  const [existing] = await service.listPerishableCategories({ category_id: categoryId })
  if (existing) await service.updatePerishableCategories({ id: existing.id, perishable })
  else await service.createPerishableCategories({ category_id: categoryId, perishable })
  return categoryPerishable(scope, categoryId)
}
