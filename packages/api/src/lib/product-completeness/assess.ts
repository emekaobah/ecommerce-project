import { ProductChangeActionType } from "@mercurjs/types"

/**
 * The publish rule, as pure functions: what a product must have before it can
 * be published, and how complete it is. Everything that enforces or displays the
 * rule (the publish gate, the completeness endpoints, the panel widgets) reads
 * its answer from here.
 */

/** What the rule needs to know about a product; gathered by `loadProductFacts`. */
export type ProductFacts = {
  id: string
  status: string
  title: string | null
  image_count: number
  has_thumbnail: boolean
  category_ids: string[]
  /** Product weight in grams. */
  weight: number | null
  /** Each variant's weight (grams) and every price on it, offer prices included. */
  variants: { id: string; weight: number | null; price_amounts: number[] }[]
  /** Global and scoped attributes the product holds, with their value ids. */
  attribute_values: Record<string, string[]>
}

/** A required global attribute and the categories it is linked to (none = all). */
export type RequiredAttribute = {
  id: string
  name: string
  category_ids: string[]
}

export type CompletenessCheck = {
  /** Stable key: `title`, `selling_price`, `image`, `category`, `weight`, or `attribute:<id>`. */
  key: string
  label: string
  passed: boolean
}

export type ProductCompleteness = {
  product_id: string
  /** Whole percentage of checks passed (0–100); 100 only when complete. */
  score: number
  is_complete: boolean
  checks: CompletenessCheck[]
  missing: { key: string; label: string }[]
}

const positive = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) && n > 0

/**
 * Required attributes that apply to a product, mirroring how Mercur surfaces
 * attributes on the product form: an attribute linked to categories applies to
 * products in one of those categories; an unlinked one applies to every product.
 */
export function applicableRequiredAttributes(
  facts: Pick<ProductFacts, "category_ids">,
  required: RequiredAttribute[]
): RequiredAttribute[] {
  const categories = new Set(facts.category_ids)
  return required.filter((a) => !a.category_ids.length || a.category_ids.some((id) => categories.has(id)))
}

export function assessProductCompleteness(facts: ProductFacts, required: RequiredAttribute[]): ProductCompleteness {
  const { variants } = facts
  const checks: CompletenessCheck[] = [
    { key: "title", label: "Title", passed: !!facts.title?.trim() },
    { key: "selling_price", label: "Selling price", passed: variants.some((v) => v.price_amounts.some(positive)) },
    { key: "image", label: "Image", passed: facts.image_count > 0 || facts.has_thumbnail },
    { key: "category", label: "Category", passed: facts.category_ids.length > 0 },
    {
      key: "weight",
      label: "Weight",
      passed: positive(facts.weight) || (variants.length > 0 && variants.every((v) => positive(v.weight))),
    },
    ...applicableRequiredAttributes(facts, required).map((a) => ({
      key: `attribute:${a.id}`,
      label: a.name,
      passed: (facts.attribute_values[a.id] ?? []).length > 0,
    })),
  ]

  const passed = checks.filter((c) => c.passed).length
  const missing = checks.filter((c) => !c.passed).map(({ key, label }) => ({ key, label }))
  return {
    product_id: facts.id,
    score: Math.floor((passed / checks.length) * 100),
    is_complete: missing.length === 0,
    checks,
    missing,
  }
}

/** A pending edit, in Mercur's product-change action shape. */
export type PendingAction = { action: string; details?: Record<string, any> | null }

/** Stands in for a scalar (text, unit, toggle) value that a pending edit sets. */
const PENDING_VALUE = "pending_value"

export const toNumber = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v))
const idsOf = (list: unknown) =>
  Array.isArray(list) ? list.map((c: any) => (typeof c === "string" ? c : c?.id)).filter(Boolean) : []
const scalarSet = (value: unknown) => value !== undefined && value !== null && value !== ""

/**
 * The product as it would be once pending edits are applied, so the gate can
 * refuse an edit before anything is written. Covers every field the rule reads.
 */
export function withPendingActions(facts: ProductFacts, actions: PendingAction[]): ProductFacts {
  const next: ProductFacts = {
    ...facts,
    variants: facts.variants.map((v) => ({ ...v })),
    attribute_values: { ...facts.attribute_values },
  }
  actions.forEach(({ action, details }, index) => APPLY[action]?.(next, details ?? {}, index))
  return next
}

type Apply = (next: ProductFacts, d: Record<string, any>, index: number) => void

/** How each kind of pending action changes the facts the rule reads. */
const APPLY: Partial<Record<string, Apply>> = {
  [ProductChangeActionType.STATUS_CHANGE]: (next, d) => {
    if (d.status !== undefined) next.status = d.status
  },
  [ProductChangeActionType.UPDATE]: (next, d) => applyFieldUpdate(next, d.field, d.value),
  [ProductChangeActionType.VARIANT_ADD]: (next, d, index) => {
    next.variants.push({ id: `pending_${index}`, weight: toNumber(d.variant?.weight), price_amounts: [] })
  },
  [ProductChangeActionType.VARIANT_UPDATE]: (next, d) => {
    const variant = next.variants.find((v) => v.id === d.variant_id)
    if (variant && d.fields && "weight" in d.fields) variant.weight = toNumber(d.fields.weight)
  },
  [ProductChangeActionType.VARIANT_REMOVE]: (next, d) => {
    next.variants = next.variants.filter((v) => v.id !== d.variant_id)
  },
  [ProductChangeActionType.ATTRIBUTE_ADD]: (next, d) => {
    const attribute = d.attribute ?? {}
    if (attribute.id) next.attribute_values[attribute.id] = addedValues(attribute)
  },
  [ProductChangeActionType.ATTRIBUTE_REMOVE]: (next, d) => {
    delete next.attribute_values[d.attribute_id]
  },
  [ProductChangeActionType.ATTRIBUTE_UPDATE]: (next, d) => {
    const update = d.update ?? {}
    if (update.id) next.attribute_values[update.id] = updatedValues(next.attribute_values[update.id], update)
  },
}

function applyFieldUpdate(next: ProductFacts, field: unknown, value: any): void {
  switch (field) {
    case "title":
      next.title = value ?? null
      break
    case "images":
      next.image_count = Array.isArray(value) ? value.length : 0
      break
    case "thumbnail":
      next.has_thumbnail = !!value
      break
    case "weight":
      next.weight = toNumber(value)
      break
    case "categories":
    case "category_ids":
      next.category_ids = idsOf(value)
      break
    case "status":
      if (value !== undefined) next.status = value
      break
  }
}

function addedValues(attribute: { value_ids?: string[]; value?: unknown }): string[] {
  if (attribute.value_ids?.length) return [...attribute.value_ids]
  return scalarSet(attribute.value) ? [PENDING_VALUE] : []
}

function updatedValues(
  current: string[] | undefined,
  update: { value_ids?: string[]; value?: unknown; add?: unknown[]; remove?: string[] }
): string[] {
  let values = new Set(current ?? [])
  if (update.value_ids !== undefined) values = new Set(update.value_ids)
  else if (update.value !== undefined) values = new Set(scalarSet(update.value) ? [PENDING_VALUE] : [])
  for (const entry of update.add ?? []) values.add(typeof entry === "string" ? entry : PENDING_VALUE)
  for (const entry of update.remove ?? []) values.delete(entry)
  return [...values]
}
