import { asValue } from "@medusajs/framework/awilix"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ENRICHMENT_SOURCES, type ConfiguredSource } from "../../src/lib/enrichment/sources"
import type { EnrichmentSource, SourceMatch, SourcePolicy } from "../../src/lib/enrichment/source"
import type { DraftClient } from "../../src/lib/enrichment/ai-draft"

/** A product database that knows the given barcodes, with an open licence unless the policy says otherwise. */
export function fakeSource(
  id: string,
  byBarcode: Record<string, SourceMatch>,
  policy: Partial<SourcePolicy> = {}
): EnrichmentSource {
  return {
    id,
    name: id.replaceAll("_", " "),
    policy: { public_data: true, image_rights: true, attribution: null, requests_per_minute: 6000, ...policy },
    lookup: async ({ barcode }) => (barcode ? byBarcode[barcode] ?? null : null),
  }
}

/** Replaces the configured sources, in priority order, for the rest of the test. */
export function useSources(container: MedusaContainer, sources: ConfiguredSource[]) {
  ;(container as any).register(ENRICHMENT_SOURCES, asValue(sources))
}

// The smallest valid PNG: one transparent pixel.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
)

/**
 * Serves a tiny PNG for every image URL on `hosts` (a 404 for paths under
 * `/missing`), so copying images into storage needs no network; other requests
 * pass through. Returns the image URLs fetched.
 */
export function fakeImageHosts(hosts: string[]) {
  const fetched: string[] = []
  const real = globalThis.fetch
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!hosts.includes(new URL(url).host)) return real(input, init)
    fetched.push(url)
    if (new URL(url).pathname.startsWith("/missing")) return new Response("Not found", { status: 404 })
    return new Response(PIXEL, { status: 200, headers: { "content-type": "image/png" } })
  })
  return fetched
}

type Api = { get: (url: string, config?: unknown) => Promise<{ data: any }> }

/** Waits for the background worker to finish enriching a product, and returns its record. */
export async function enrichmentOf(api: Api, admin: unknown, productId: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { data } = await api.get(`/admin/products/${productId}/enrichment`, admin)
    if (data.enrichment.status !== "queued") return data.enrichment
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Enrichment of ${productId} didn't finish`)
}

/** Stands in for Claude: answers every draft request with the given draft, and records the requests. */
export function fakeClaude(draft: Record<string, unknown>) {
  const requests: any[] = []
  const client: DraftClient = {
    beta: {
      messages: {
        parse: (async (params: any) => {
          requests.push(params)
          return { stop_reason: "end_turn", parsed_output: draft, content: [] }
        }) as any,
      },
    },
  }
  return { client, requests }
}
