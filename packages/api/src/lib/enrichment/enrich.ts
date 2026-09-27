import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { ProductStatus } from "@mercurjs/types"
import { PRODUCT_ENRICHMENT_MODULE } from "../../modules/product-enrichment"
import type ProductEnrichmentModuleService from "../../modules/product-enrichment/service"
import { getProductCompleteness } from "../product-completeness"
import { copyImage } from "./images"
import type { Attribution, EnrichmentSource, SourceMatch } from "./source"
import { configuredSources, type ConfiguredSource } from "./sources"

/** The product fields enrichment fills. */
export const ENRICHABLE_FIELDS = ["title", "description", "weight", "images", "categories"] as const
export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number]

/** Where a field's value came from: `supplied` for the submitter's own data, else a source id. */
export type Provenance = { source: string; url: string | null }
export type StoredImage = { url: string; source: string; source_url: string }

const LABELS: Record<EnrichableField, string> = {
  title: "Title",
  description: "Description",
  weight: "Weight",
  images: "Images",
  categories: "Category",
}

type Scope = Pick<MedusaContainer, "resolve">

type ProductRow = {
  id: string
  title: string
  description: string | null
  weight: number | string | null
  images?: { url: string }[] | null
  variants?: { barcode: string | null; ean: string | null; upc: string | null }[] | null
}

type Category = { id: string; name: string; handle: string }

const service = (scope: Scope) => scope.resolve<ProductEnrichmentModuleService>(PRODUCT_ENRICHMENT_MODULE)
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Enriches one queued product: fills the fields its submitter left empty from the
 * configured sources in priority order (a lower source only fills what the ones
 * above left empty), copies its images into storage, then publishes it or sends
 * it for review. Records where every field came from. A source that fails to
 * answer is recorded and skipped.
 */
export async function enrichProduct(container: MedusaContainer, productId: string): Promise<void> {
  const enrichments = service(container)
  const [record] = await enrichments.listProductEnrichments({ product_id: productId })
  if (!record || record.status !== "queued") return
  try {
    const result = await fill(container, productId, record.fields as Record<string, Provenance>)
    const outcome = await decide(container, productId, record.submitter, result)
    await enrichments.updateProductEnrichments({
      id: record.id,
      status: "done",
      outcome: outcome.outcome,
      fields: result.fields,
      images: { items: result.images },
      attribution: { items: result.attribution },
      reasons: { items: outcome.reasons },
      errors: { items: result.errors },
      enriched_at: new Date(),
    })
  } catch (error) {
    await enrichments.updateProductEnrichments({
      id: record.id,
      status: "failed",
      errors: { items: [message(error)] },
      enriched_at: new Date(),
    })
  }
}

type FillResult = {
  fields: Partial<Record<EnrichableField, Provenance>>
  images: StoredImage[]
  attribution: Attribution[]
  errors: string[]
  /** Sources that filled at least one field. */
  contributors: ConfiguredSource[]
}

async function fill(container: MedusaContainer, productId: string, supplied: Record<string, Provenance>): Promise<FillResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [product],
  } = (await query.graph({
    entity: "product",
    fields: ["id", "title", "description", "weight", "images.url", "variants.barcode", "variants.ean", "variants.upc"],
    filters: { id: productId },
  })) as { data: ProductRow[] }
  const { data: categories } = (await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle"],
  })) as { data: Category[] }

  const fields: FillResult["fields"] = { ...supplied }
  const errors: string[] = []
  const contributors: ConfiguredSource[] = []
  const update: Record<string, unknown> = {}
  let images: StoredImage[] = []

  // The submitter's own images are copied too: nothing is hotlinked.
  if (fields.images) {
    images = await copyAll(container, (product.images ?? []).map((i) => i.url), "supplied", errors)
    if (images.length) update.images = images
    else delete fields.images
  }

  const barcode = product.variants?.map((v) => v.barcode ?? v.ean ?? v.upc).find(Boolean) ?? null
  const needed = () => ENRICHABLE_FIELDS.filter((f) => !fields[f])
  for (const configured of configuredSources(container)) {
    if (!needed().length) break
    const { source } = configured
    if (!source.policy.public_data) continue
    let match: SourceMatch | null
    try {
      await rateLimit(source)
      match = await source.lookup({ barcode, title: fields.title ? product.title : null })
    } catch (error) {
      errors.push(`${source.name}: ${message(error)}`)
      continue
    }
    if (!match) continue

    let contributed = false
    const provenance = { source: source.id, url: match.url }
    for (const field of needed()) {
      const value = await valueOf(container, field, match, source, categories, errors)
      if (value === undefined) continue
      if (field === "images") images = value as StoredImage[]
      update[field] = value
      fields[field] = provenance
      contributed = true
    }
    if (contributed) contributors.push(configured)
  }

  if (Object.keys(update).length) await updateProductsWorkflow(container).run({ input: { selector: { id: productId }, update: toProductUpdate(update) } })

  const attribution = contributors
    .map((c) => c.source.policy.attribution)
    .filter((a): a is Attribution => !!a)
  return { fields, images, attribution, errors, contributors }
}

/** A source's value for one field, in the form the product takes it, or undefined when it has none. */
async function valueOf(
  scope: Scope,
  field: EnrichableField,
  match: SourceMatch,
  source: EnrichmentSource,
  categories: Category[],
  errors: string[]
): Promise<unknown> {
  const { fields } = match
  switch (field) {
    case "title":
      return fields.title
    case "description":
      return fields.description
    case "weight":
      return fields.weight
    case "images": {
      if (!source.policy.image_rights || !fields.image_urls?.length) return undefined
      const stored = await copyAll(scope, fields.image_urls, source.id, errors)
      return stored.length ? stored : undefined
    }
    case "categories": {
      const ids = fields.category_ids?.filter((id) => categories.some((c) => c.id === id)) ?? []
      const matched = ids.length ? ids : matchCategory(categories, fields.category_names ?? [])
      return matched.length ? matched : undefined
    }
  }
}

async function copyAll(scope: Scope, urls: string[], source: string, errors: string[]): Promise<StoredImage[]> {
  const stored: StoredImage[] = []
  for (const url of urls) {
    try {
      stored.push({ url: await copyImage(scope, url), source, source_url: url })
    } catch (error) {
      errors.push(`Image ${url}: ${message(error)}`)
    }
  }
  return stored
}

function toProductUpdate(update: Record<string, unknown>) {
  const { images, categories, ...rest } = update as { images?: StoredImage[]; categories?: string[] }
  return {
    ...rest,
    ...(images ? { images: images.map((i) => ({ url: i.url })), thumbnail: images[0].url } : {}),
    ...(categories ? { category_ids: categories } : {}),
  }
}

/** "rices" → "rice", "berries" → "berry", "dresses" → "dress"; enough to match category names. */
function singular(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`
  if (/(ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1)
  return word
}
const words = (name: string) =>
  name
    .toLowerCase()
    .split(/\s*(?:&|,|\band\b)\s*/)
    .map((w) => singular(w.trim()))
    .filter(Boolean)

/**
 * The catalogue category a source's category names point to: the most specific
 * name that equals a catalogue category's name, or one of its "&"-joined parts
 * ("rices" finds "Rice & Grains"), ignoring case and plurals.
 */
export function matchCategory(categories: Category[], names: string[]): string[] {
  for (const name of names) {
    const wanted = words(name).join(" ")
    const found = categories.find((c) => words(c.name).join(" ") === wanted || words(c.name).includes(wanted))
    if (found) return [found.id]
  }
  return []
}

/** Paces lookups to each source's allowance, within this process. */
const nextLookupAt = new Map<string, number>()
async function rateLimit(source: EnrichmentSource) {
  const now = Date.now()
  const at = Math.max(now, nextLookupAt.get(source.id) ?? 0)
  nextLookupAt.set(source.id, at + 60_000 / source.policy.requests_per_minute)
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now))
}

/**
 * Publishes the product or sends it for review, by who vouches for its data
 * (docs/design.md): a field from an untrusted source needs review, as does a
 * vendor's product that no trusted source matched with an image and a category.
 * Otherwise it is published if complete, and left a draft saying what it lacks if not.
 */
async function decide(
  container: MedusaContainer,
  productId: string,
  submitter: "operator" | "vendor",
  { fields, contributors }: FillResult
): Promise<{ outcome: "published" | "needs_review" | "incomplete"; reasons: string[] }> {
  const contributorById = new Map(contributors.map((c) => [c.source.id, c]))
  const reasons: string[] = []
  for (const field of ENRICHABLE_FIELDS) {
    const from = fields[field]
    if (!from || from.source === "supplied") continue
    const contributor = contributorById.get(from.source)
    if (contributor && !contributor.trusted) {
      reasons.push(`${LABELS[field]} came from ${contributor.source.name}, which isn't trusted.`)
    }
  }
  const confirmed = contributors.some((c) => c.trusted) && !!fields.images && !!fields.categories
  if (submitter === "vendor" && !confirmed) {
    reasons.push("A shop proposed it, and no trusted source confirmed it with an image and a category.")
  }

  if (reasons.length) {
    await updateProductsWorkflow(container).run({
      input: { selector: { id: productId }, update: { status: ProductStatus.PROPOSED } },
    })
    return { outcome: "needs_review", reasons }
  }
  const completeness = await getProductCompleteness(container, productId)
  if (!completeness.is_complete) {
    return { outcome: "incomplete", reasons: completeness.missing.map((m) => `Missing ${m.label}.`) }
  }
  await updateProductsWorkflow(container).run({
    input: { selector: { id: productId }, update: { status: ProductStatus.PUBLISHED } },
  })
  return { outcome: "published", reasons: [] }
}
