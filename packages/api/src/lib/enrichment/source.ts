// A product database that enrichment can ask about a product. Adapters are
// pluggable: config picks which run and in what order (see ./sources).

/** What enrichment knows of the product when it asks. */
export type LookupQuery = { barcode: string | null; title: string | null }

/** The fields a source can fill. Weight is in grams; categories are the source's own names. */
export type SourceFields = {
  title?: string
  description?: string
  weight?: number
  image_urls?: string[]
  /** Most specific first; matched against the catalogue's categories by name. */
  category_names?: string[]
  /** Catalogue category ids, for a source that already speaks the catalogue's terms. */
  category_ids?: string[]
}

export type SourceMatch = {
  fields: SourceFields
  /** The source's page for this product, recorded as provenance. */
  url: string | null
}

/** A credit buyers must see when a product shows the source's data. */
export type Attribution = { name: string; url: string; license: string }

/** What a source's licence lets Oja do with its data; enrichment enforces it. */
export type SourcePolicy = {
  /** Its fields may be shown to buyers. If not, they aren't used for listing content. */
  public_data: boolean
  /** Its images may be copied into our storage and shown. */
  image_rights: boolean
  /** Credit buyers must see; null when none is required. */
  attribution: Attribution | null
  /** Most lookups a minute the source allows. */
  requests_per_minute: number
}

export interface EnrichmentSource {
  /** Stable id recorded in provenance, e.g. `open_food_facts`. */
  id: string
  name: string
  policy: SourcePolicy
  /** The source's record of the product, or null when it has none. Throws when the source can't answer. */
  lookup(query: LookupQuery): Promise<SourceMatch | null>
}
