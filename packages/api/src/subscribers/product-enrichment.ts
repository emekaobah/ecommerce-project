import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { enrichProduct, ENRICHMENT_QUEUED } from "../lib/enrichment"

// Enrichment runs here, in the worker, so an import answers straight away and
// sources are asked at their own pace (#35).
export default async function productEnrichmentHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  await enrichProduct(container, event.data.id)
}

export const config: SubscriberConfig = { event: ENRICHMENT_QUEUED }
