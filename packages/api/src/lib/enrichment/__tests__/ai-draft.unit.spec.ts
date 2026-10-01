import { claudeDraftSource, type DraftClient } from "../ai-draft"
import type { LookupQuery } from "../source"

// The smallest valid PNG: one transparent pixel.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
)

/** Serves a PNG for every image URL, and records what was fetched. */
const fakeFetch = () => {
  const fetched: string[] = []
  const fetch = async (url: string | URL) => {
    fetched.push(String(url))
    return new Response(PIXEL, { status: 200, headers: { "content-type": "image/png" } })
  }
  return { fetch: fetch as typeof globalThis.fetch, fetched }
}

/** Stands in for Claude: answers every request with the given draft, and records the requests. */
const fakeClaude = (draft: Record<string, unknown> | null, stop_reason = "end_turn") => {
  const requests: any[] = []
  const client: DraftClient = {
    beta: {
      messages: {
        parse: (async (params: any) => {
          requests.push(params)
          return { stop_reason, parsed_output: draft, content: [] }
        }) as any,
      },
    },
  }
  return { client, requests }
}

const CATEGORIES = [
  { id: "pcat_rice", name: "Rice & Grains" },
  { id: "pcat_oils", name: "Oils & Spices" },
]

const query = (overrides: Partial<LookupQuery> = {}): LookupQuery => ({
  barcode: null,
  product: { title: "Abakaliki Rice 5kg", description: null, image_urls: ["https://images.test/rice.png"] },
  wanted: ["description", "weight", "categories"],
  categories: CATEGORIES,
  ...overrides,
})

const DRAFT = {
  title: "Abakaliki Long Grain Rice",
  description: "Stone-free local rice from Ebonyi.",
  weight_grams: 5100,
  category_id: "pcat_rice",
}

describe("Claude draft source", () => {
  it("drafts the empty fields from the product's image and data, choosing a catalogue category", async () => {
    const { client, requests } = fakeClaude(DRAFT)
    const { fetch, fetched } = fakeFetch()

    const match = await claudeDraftSource({ client, fetch }).lookup(query())

    // The title was the submitter's, so the draft's title is left out.
    expect(match).toEqual({
      url: null,
      fields: { description: "Stone-free local rice from Ebonyi.", weight: 5100, category_ids: ["pcat_rice"] },
    })
    expect(fetched).toEqual(["https://images.test/rice.png"])
    const [request] = requests
    expect(request.model).toBe("claude-opus-5-5")
    const [image, text] = request.messages[0].content
    expect(image).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: PIXEL.toString("base64") } })
    expect(text.text).toContain("Abakaliki Rice 5kg")
    expect(text.text).toContain("pcat_rice: Rice & Grains")
  })

  it("keeps only what it could tell: no category outside the catalogue, no weight of nothing", async () => {
    const { client } = fakeClaude({ ...DRAFT, weight_grams: 0, category_id: "pcat_unknown", description: " " })

    const match = await claudeDraftSource({ client, fetch: fakeFetch().fetch }).lookup(query())

    expect(match).toBeNull()
  })

  it("drafts from the name alone when the product has no photo", async () => {
    const { client, requests } = fakeClaude(DRAFT)

    const match = await claudeDraftSource({ client, fetch: fakeFetch().fetch }).lookup(
      query({ product: { title: "Abakaliki Rice 5kg", description: null, image_urls: [] }, wanted: ["description"] })
    )

    expect(match?.fields).toEqual({ description: "Stone-free local rice from Ebonyi." })
    expect(requests[0].messages[0].content.map((c: any) => c.type)).toEqual(["text"])
  })

  it("drafts from the photos that load when another can't be fetched", async () => {
    const { client, requests } = fakeClaude(DRAFT)
    const fetch = (async (url: string | URL) =>
      String(url).includes("missing")
        ? new Response("Not found", { status: 404 })
        : new Response(PIXEL, { status: 200, headers: { "content-type": "image/png" } })) as typeof globalThis.fetch
    const product = { title: "Abakaliki Rice 5kg", description: null, image_urls: ["https://images.test/missing.png", "https://images.test/rice.png"] }

    const match = await claudeDraftSource({ client, fetch }).lookup(query({ product }))

    expect(match?.fields.description).toBe("Stone-free local rice from Ebonyi.")
    expect(requests[0].messages[0].content.map((c: any) => c.type)).toEqual(["image", "text"])
  })

  it("doesn't ask Claude when there's nothing to go on or nothing it can fill", async () => {
    const { client, requests } = fakeClaude(DRAFT)
    const source = claudeDraftSource({ client, fetch: fakeFetch().fetch })

    expect(await source.lookup(query({ product: { title: null, description: null, image_urls: [] } }))).toBeNull()
    expect(await source.lookup(query({ wanted: ["images"] }))).toBeNull()
    expect(requests).toHaveLength(0)
  })

  it("fails when Claude declines, so enrichment records it and carries on", async () => {
    const { client } = fakeClaude(null, "refusal")

    await expect(claudeDraftSource({ client, fetch: fakeFetch().fetch }).lookup(query())).rejects.toThrow(
      "Claude declined to draft this product"
    )
  })

  it("marks its values as drafts that always need a person's review", () => {
    const source = claudeDraftSource({ client: fakeClaude(DRAFT).client })
    expect(source.drafts).toBe(true)
    expect(source.policy.image_rights).toBe(false)
  })
})
