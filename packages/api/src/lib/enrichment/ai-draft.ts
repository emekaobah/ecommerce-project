import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
// The SDK's structured-output helper takes zod 4 schemas, which zod 3.25 ships as `zod/v4`.
import * as z from "zod/v4"
import type { EnrichableField } from "./enrich"
import { fetchImage } from "./images"
import type { EnrichmentSource, LookupQuery, SourceFields } from "./source"

// The last resort (#36): for fields no database filled, Claude drafts values from the
// product's photo and data. Drafts are flagged and always reviewed by a person
// (docs/design.md), so this source is never trusted, whatever config says.

const MODEL = "claude-opus-5-5"
/** Enough of the product to recognise it; more photos add cost, not accuracy. */
const MAX_IMAGES = 3
/** The fields Claude can draft, by the name its answer gives each; images must be real photos, never generated. */
const ANSWER_KEYS: Partial<Record<EnrichableField, keyof Draft>> = {
  title: "title",
  description: "description",
  weight: "weight_grams",
  categories: "category_id",
}
const DRAFTABLE = Object.keys(ANSWER_KEYS) as EnrichableField[]

/** The part of the Anthropic client the source uses, so tests can stand in for Claude. */
export type DraftClient = { beta: { messages: Pick<Anthropic["beta"]["messages"], "parse"> } }

type Options = { client?: DraftClient; fetch?: typeof globalThis.fetch }

const SYSTEM = `You draft product listings for Oja, an online marketplace in Nigeria.
You are given what is known about one product, usually with its photo, and fill in only the fields asked for.
- Describe only what the photo and data show. Do not invent brands, ingredients, specifications, certifications or health claims.
- title: the product's name as a shopper would search for it, with its size or quantity when visible.
- description: one or two plain sentences for a shopper.
- weight_grams: the shipping weight of one unit in grams, packaging included, estimated from the product and its size.
- category_id: the id of the one listed category the product belongs in.
Answer null for any field not asked for, and for any field you can't tell with reasonable confidence.`

function draftSchema(categoryIds: string[]) {
  const [first, ...rest] = categoryIds
  return z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
    weight_grams: z.number().nullable(),
    // Constrained to the catalogue's categories when it has any.
    category_id: (first ? z.enum([first, ...rest]) : z.string()).nullable(),
  })
}

type Draft = z.infer<ReturnType<typeof draftSchema>>

/**
 * Claude drafting the empty fields from the product's photo, name and description. Asks
 * nothing when the product has neither a photo nor a name, or none of its empty fields can
 * be drafted. Throws when Claude can't answer or declines, so enrichment records it.
 */
export function claudeDraftSource(options: Options = {}): EnrichmentSource {
  const fetch = options.fetch ?? globalThis.fetch
  return {
    id: "ai_draft",
    name: "AI draft (Claude)",
    drafts: true,
    // Claude's output is ours to show; it supplies no images and needs no credit.
    policy: { public_data: true, image_rights: false, attribution: null, requests_per_minute: 50 },
    async lookup(query) {
      const wanted = (query.wanted ?? DRAFTABLE).filter((f) => DRAFTABLE.includes(f))
      const product = query.product ?? { title: null, description: null, image_urls: [] }
      if (!wanted.length || (!product.title && !product.image_urls.length)) return null

      const categories = query.categories ?? []
      // Drafts from the photos that load; only when none does and there's no name either is there nothing to go on.
      const fetched = await Promise.allSettled(product.image_urls.slice(0, MAX_IMAGES).map((url) => fetchImage(url, fetch)))
      const images = fetched.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
      const failed = fetched.find((r): r is PromiseRejectedResult => r.status === "rejected")
      if (!images.length && !product.title && failed) throw failed.reason
      // Created per lookup, so a deployment without a key fails here, recorded, not at boot.
      const client = options.client ?? new Anthropic()
      const response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        // A declined draft is retried on the fallback model the API picks for the refusal.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(draftSchema(categories.map((c) => c.id))) },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((image) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: image.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                  data: image.bytes.toString("base64"),
                },
              })),
              { type: "text" as const, text: prompt(query, wanted, images.length) },
            ],
          },
        ],
      })
      if (response.stop_reason === "refusal") throw new Error("Claude declined to draft this product")
      if (!response.parsed_output) throw new Error(`Claude's draft couldn't be read (${response.stop_reason})`)

      const fields = fieldsOf(response.parsed_output, wanted, categories)
      return Object.keys(fields).length ? { url: null, fields } : null
    },
  }
}

function prompt({ product, categories = [] }: LookupQuery, wanted: EnrichableField[], photos: number) {
  return [
    `Product name: ${product?.title ?? "(unknown)"}`,
    `Description: ${product?.description ?? "(none)"}`,
    `Photos: ${photos ? "above" : "none"}`,
    "",
    `Fill in: ${wanted.map((f) => ANSWER_KEYS[f]).join(", ")}`,
    "",
    "Categories (id: name):",
    ...categories.map((c) => `${c.id}: ${c.name}`),
  ].join("\n")
}

/** The draft's values for the fields asked for, dropping blanks and anything outside the catalogue. */
function fieldsOf(draft: Draft, wanted: EnrichableField[], categories: { id: string }[]): SourceFields {
  const fields: SourceFields = {}
  const title = draft.title?.trim()
  if (wanted.includes("title") && title) fields.title = title
  const description = draft.description?.trim()
  if (wanted.includes("description") && description) fields.description = description
  if (wanted.includes("weight") && draft.weight_grams && draft.weight_grams > 0) fields.weight = Math.round(draft.weight_grams)
  if (wanted.includes("categories") && draft.category_id && categories.some((c) => c.id === draft.category_id)) {
    fields.category_ids = [draft.category_id]
  }
  return fields
}
