import type { MedusaContainer } from "@medusajs/framework/types"
import { claudeDraftSource } from "./ai-draft"
import { catalogueSource } from "./catalogue"
import { openBeautyFacts, openFoodFacts, openProductsFacts } from "./open-facts"
import type { EnrichmentSource } from "./source"

/** A source as configured: whether its data is trusted decides if products it fills need review. */
export type ConfiguredSource = { source: EnrichmentSource; trusted: boolean }

/** Container key under which tests (or a deployment) can register sources directly. */
export const ENRICHMENT_SOURCES = "enrichmentSources"

type Scope = Pick<MedusaContainer, "resolve">

/** Every adapter config can name, by id. Adding a database means adding its adapter here. */
const ADAPTERS: Record<string, (scope: Scope) => EnrichmentSource> = {
  catalogue: catalogueSource,
  open_food_facts: () => openFoodFacts(),
  open_beauty_facts: () => openBeautyFacts(),
  open_products_facts: () => openProductsFacts(),
  ai_draft: () => claudeDraftSource(),
}

// The demo's sources. Only the catalogue is trusted unless config says otherwise:
// Open Facts is crowd-sourced, so a deployment that forgets to configure trust
// sends its matches for review rather than publishing them (docs/design.md).
// Claude drafts what they leave empty, last, when the deployment has an Anthropic key (#36).
const defaultSources = () =>
  `catalogue,open_food_facts,open_beauty_facts,open_products_facts${process.env.ANTHROPIC_API_KEY ? ",ai_draft" : ""}`
const DEFAULT_TRUSTED = "catalogue"

const idsOf = (list: string) =>
  list
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

/**
 * The sources to ask, in priority order. Config: `ENRICHMENT_SOURCES` lists
 * adapter ids in order (empty for none), `ENRICHMENT_TRUSTED_SOURCES` the ones
 * whose data needs no review (AI drafts always need one, whatever this says). Sources registered in the container take precedence.
 */
export function configuredSources(scope: Scope): ConfiguredSource[] {
  const registered = (scope as { hasRegistration?: (key: string) => boolean }).hasRegistration?.(ENRICHMENT_SOURCES)
  if (registered) return scope.resolve<ConfiguredSource[]>(ENRICHMENT_SOURCES)

  const ids = idsOf(process.env.ENRICHMENT_SOURCES ?? defaultSources())
  const trusted = new Set(idsOf(process.env.ENRICHMENT_TRUSTED_SOURCES ?? DEFAULT_TRUSTED))
  return ids.map((id) => {
    const adapter = ADAPTERS[id]
    if (!adapter) throw new Error(`ENRICHMENT_SOURCES names an unknown source "${id}".`)
    return { source: adapter(scope), trusted: trusted.has(id) }
  })
}
