import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { ProductStatus } from "@mercurjs/types"
import { errorMessage as message } from "../errors"
import { getProductCompleteness } from "../product-completeness"
import { copyImage } from "./images"
import { enrichmentOf, enrichmentService, type EnrichmentOutcome, type Submitter } from "./record"
import type { Attribution, EnrichmentSource, LookupQuery, SourceMatch } from "./source"
import { configuredSources, type ConfiguredSource } from "./sources"

/** The product fields enrichment fills. */
export const ENRICHABLE_FIELDS = ["title", "description", "weight", "images", "categories"] as const
export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number]

/**
 * Where a field's value came from: `supplied` for the submitter's own data, else a source id.
 * `drafted` flags an AI draft (#36), which a person must check.
 */
export type Provenance = { source: string; url: string | null; drafted?: true }
export type StoredImage = { url: string; source: string; source_url: string }

/** A submitter's image that is already in our file storage (a quick-add photo, #38): its own source. */
export const storedBySubmitter = (url: string): StoredImage => ({ url, source: "supplied", source_url: url })

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
  title: string | null
  description: string | null
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
  if (record?.status !== "queued") return
  try {
    const supplied = (record.supplied as { items?: EnrichableField[] }).items ?? []
    const stored = (record.images as { items?: StoredImage[] } | null)?.items ?? []
    const result = await fill(container, productId, supplied, stored)
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

/** What filling has gathered so far: each field's provenance and the product update to write. */
type FillState = FillResult & {
  /** Credits carried by a match's data itself (a catalogue product that took Open Facts data). */
  credits: Attribution[]
  update: Record<string, unknown>
  categories: Category[]
}

async function fill(
  container: MedusaContainer,
  productId: string,
  supplied: EnrichableField[],
  stored: StoredImage[]
): Promise<FillResult> {
  const { product, categories } = await loadProduct(container, productId)
  const state: FillState = {
    fields: Object.fromEntries(supplied.map((f) => [f, { source: "supplied", url: null }])),
    images: [],
    attribution: [],
    errors: [],
    contributors: [],
    credits: [],
    update: {},
    categories,
  }

  // The submitter's own images are copied too: nothing is hotlinked, so one that
  // can't be copied is dropped, and a source may fill the gap. One the submitter
  // already put in our storage is kept as it is.
  if (state.fields.images) {
    state.images = await keepOrCopy(container, (product.images ?? []).map((i) => i.url), stored, state.errors)
    state.update.images = state.images
    if (!state.images.length) delete state.fields.images
  }

  const barcode = product.variants?.map((v) => v.barcode ?? v.ean ?? v.upc).find(Boolean) ?? null
  for (const configured of configuredSources(container)) {
    if (!neededFields(state).length) break
    const match = await ask(configured.source, lookupQuery(state, product, barcode), state.errors)
    if (match) await applyMatch(container, state, configured, match)
  }

  if (Object.keys(state.update).length) {
    await updateProductsWorkflow(container).run({
      input: { selector: { id: productId }, update: toProductUpdate(state.update) },
    })
  }

  const { fields, images, errors, contributors, credits } = state
  const attribution = uniqueByName([
    ...contributors.map((c) => c.source.policy.attribution).filter((a): a is Attribution => !!a),
    ...credits,
  ])
  return { fields, images, attribution, errors, contributors }
}

async function loadProduct(container: MedusaContainer, productId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [product],
  } = (await query.graph({
    entity: "product",
    fields: ["id", "title", "description", "images.url", "variants.barcode", "variants.ean", "variants.upc"],
    filters: { id: productId },
  })) as { data: ProductRow[] }
  const { data: categories } = (await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle"],
  })) as { data: Category[] }
  return { product, categories }
}

const neededFields = (state: FillState) => ENRICHABLE_FIELDS.filter((f) => !state.fields[f])

/** What the next source is told: the product as filled so far, and what it still lacks. */
function lookupQuery(state: FillState, product: ProductRow, barcode: string | null): LookupQuery {
  const filled = (field: "title" | "description") => (state.update[field] as string | undefined) ?? product[field] ?? null
  return {
    barcode,
    // Images by where they were copied from: our storage may not be reachable from outside.
    product: { title: filled("title"), description: filled("description"), image_urls: state.images.map((i) => i.source_url) },
    wanted: neededFields(state),
    categories: state.categories.map(({ id, name }) => ({ id, name })),
  }
}

/** The source's record of the product, or null when it has none, may not be shown, or fails to answer (recorded). */
async function ask(source: EnrichmentSource, query: LookupQuery, errors: string[]): Promise<SourceMatch | null> {
  if (!source.policy.public_data) return null
  try {
    await rateLimit(source)
    return await source.lookup(query)
  } catch (error) {
    errors.push(`${source.name}: ${message(error)}`)
    return null
  }
}

/** Fills each still-empty field the match has, recording the source as its provenance. */
async function applyMatch(container: MedusaContainer, state: FillState, configured: ConfiguredSource, match: SourceMatch) {
  const { source } = configured
  const provenance: Provenance = { source: source.id, url: match.url, ...(source.drafts ? { drafted: true as const } : {}) }
  let contributed = false
  for (const field of neededFields(state)) {
    const value = await valueOf(container, field, match, source, state.categories, state.errors)
    if (value === undefined) continue
    if (field === "images") state.images = value as StoredImage[]
    state.update[field] = value
    state.fields[field] = provenance
    contributed = true
  }
  if (contributed) {
    state.contributors.push(configured)
    state.credits.push(...(match.attribution ?? []))
  }
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

/** The submitter's images in order: those already in our storage kept, the rest copied there. */
async function keepOrCopy(scope: Scope, urls: string[], stored: StoredImage[], errors: string[]): Promise<StoredImage[]> {
  const storedByUrl = new Map(stored.map((s) => [s.url, s]))
  const copied = await copyAll(scope, urls.filter((url) => !storedByUrl.has(url)), "supplied", errors)
  const copiedByUrl = new Map(copied.map((c) => [c.source_url, c]))
  return urls.flatMap((url) => storedByUrl.get(url) ?? copiedByUrl.get(url) ?? [])
}

/** Copies the images at once, keeping their order; one that can't be copied is dropped, saying why. */
async function copyAll(scope: Scope, urls: string[], source: string, errors: string[]): Promise<StoredImage[]> {
  const copied = await Promise.allSettled(urls.map((url) => copyImage(scope, url)))
  const stored: StoredImage[] = []
  copied.forEach((result, i) => {
    if (result.status === "fulfilled") stored.push({ url: result.value, source, source_url: urls[i] })
    else errors.push(`Image ${urls[i]}: ${message(result.reason)}`)
  })
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
    .split(/[&,]|\band\b/)
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
 * (docs/design.md): an AI-drafted field or a field from an untrusted source needs
 * review, as does a vendor's product that no trusted source matched with an image
 * and a category.
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
    // A draft always needs a person, whatever the deployment trusts.
    if (from.drafted) {
      reasons.push(`${LABELS[field]} was drafted by AI; a person must check it.`)
    } else if (contributor && !contributor.trusted) {
      reasons.push(`${LABELS[field]} came from ${contributor.source.name}, which isn't trusted.`)
    }
  }
  // The image and category themselves must come from a trusted source, not the vendor or an untrusted one.
  const fromTrusted = (field: EnrichableField) =>
    !fields[field]?.drafted && !!contributorById.get(fields[field]?.source ?? "")?.trusted
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
