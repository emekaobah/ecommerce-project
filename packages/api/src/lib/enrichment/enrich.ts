import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { ProductStatus } from "@mercurjs/types"
import { errorMessage as message } from "../errors"
import { getProductCompleteness } from "../product-completeness"
import { copyImage } from "./images"
import { enrichmentOf, enrichmentService, type EnrichmentOutcome, type Submitter } from "./record"
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


/**
 * Enriches one queued product: fills the fields its submitter left empty from the
 * configured sources in priority order (a lower source only fills what the ones
 * above left empty), copies its images into storage, then publishes it or sends
 * it for review. Records where every field came from. A source that fails to
 * answer is recorded and skipped.
 */
export async function enrichProduct(container: MedusaContainer, productId: string): Promise<void> {
  const enrichments = enrichmentService(container)
  const record = await enrichmentOf(container, productId)
  if (!record || record.status !== "queued") return
  try {
    const supplied = (record.supplied as { items?: EnrichableField[] }).items ?? []
    const result = await fill(container, productId, supplied)
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

async function fill(container: MedusaContainer, productId: string, supplied: EnrichableField[]): Promise<FillResult> {
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

  const fields: FillResult["fields"] = Object.fromEntries(supplied.map((f) => [f, { source: "supplied", url: null }]))
  const errors: string[] = []
  const contributors: ConfiguredSource[] = []
  /** Credits carried by a match's data itself (a catalogue product that took Open Facts data). */
  const credits: Attribution[] = []
  const update: Record<string, unknown> = {}
  let images: StoredImage[] = []

  // The submitter's own images are copied too: nothing is hotlinked, so one that
  // can't be copied is dropped, and a source may fill the gap.
  if (fields.images) {
    images = await copyAll(container, (product.images ?? []).map((i) => i.url), "supplied", errors)
    update.images = images
    if (!images.length) delete fields.images
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
      match = await source.lookup({ barcode })
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
    if (contributed) {
      contributors.push(configured)
      credits.push(...(match.attribution ?? []))
    }
  }

  if (Object.keys(update).length) {
    await updateProductsWorkflow(container).run({
      input: { selector: { id: productId }, update: toProductUpdate(update) },
    })
  }

  const attribution = uniqueByName([
    ...contributors.map((c) => c.source.policy.attribution).filter((a): a is Attribution => !!a),
    ...credits,
  ])
  return { fields, images, attribution, errors, contributors }
}

const uniqueByName = (credits: Attribution[]) => [...new Map(credits.map((c) => [c.name, c])).values()]

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
    ...(images ? { images: images.map((i) => ({ url: i.url })), thumbnail: images[0]?.url ?? null } : {}),
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
/** A category name's parts: "Rice & Grains" → ["rice", "grain"]. */
const nameParts = (name: string) =>
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
    const wanted = nameParts(name).join(" ")
    const found = categories.find((c) => nameParts(c.name).join(" ") === wanted || nameParts(c.name).includes(wanted))
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
  submitter: Submitter,
  { fields, contributors }: FillResult
): Promise<{ outcome: EnrichmentOutcome; reasons: string[] }> {
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
  // The image and category themselves must come from a trusted source, not the vendor or an untrusted one.
  const fromTrusted = (field: EnrichableField) => !!contributorById.get(fields[field]?.source ?? "")?.trusted
  const confirmed = fromTrusted("images") && fromTrusted("categories")
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
  const why =
    submitter === "operator"
      ? "Every field came from the operator's sheet or a trusted source, and it is complete."
      : "A trusted source confirmed it with an image and a category, and it is complete."
  return { outcome: "published", reasons: [why] }
}
