import { model } from "@medusajs/framework/utils"

/**
 * What enrichment did to one product: where each field and image came from, whom
 * buyers must credit, and whether the product was published or sent for review.
 * Kept apart from the product so admins can list outcomes and the worker can find
 * queued products.
 */
const ProductEnrichment = model
  .define("product_enrichment", {
    id: model.id({ prefix: "penr" }).primaryKey(),
    product_id: model.text().unique(),
    status: model.enum(["queued", "done", "failed"]).default("queued"),
    /** Who supplied the product's own data: the operator reviewed it at import; a vendor did not. */
    submitter: model.enum(["operator", "vendor"]),
    /** `published`: approved and complete; `needs_review`: sent to the proposal queue; `incomplete`: approved, still missing fields. */
    outcome: model.enum(["published", "needs_review", "incomplete"]).nullable(),
    /** Per field: the source that filled it (`supplied` for the submitter's own data) and its record. */
    fields: model.json().default({}),
    /** Each stored image: its URL in our file storage, its source and where it was copied from. */
    images: model.json().default({ items: [] }),
    /** Credits buyers must see, from the sources whose data the product shows. */
    attribution: model.json().default({ items: [] }),
    /** Why the product needs review or is incomplete. */
    reasons: model.json().default({ items: [] }),
    /** Sources that failed to answer; enrichment carried on without them. */
    errors: model.json().default({ items: [] }),
    enriched_at: model.dateTime().nullable(),
  })
  .indexes([{ on: ["outcome"] }, { on: ["status"] }])

export default ProductEnrichment
