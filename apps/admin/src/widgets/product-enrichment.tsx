import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import { ClientError } from "@mercurjs/client"
import { Badge, Container, Heading, StatusBadge, Text, Tooltip } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { client } from "../lib/client"

type Outcome = "published" | "needs_review" | "incomplete"
/** `drafted`: an AI draft, which the admin must check before approving (#36). */
type Provenance = { source: string; url: string | null; drafted?: true }
type Enrichment = {
  status: "queued" | "done" | "failed"
  outcome: Outcome | null
  fields: Record<string, Provenance>
  reasons: { items: string[] }
}

const OUTCOME_COLOR = { published: "green", needs_review: "orange", incomplete: "grey" } as const

// Where this product's fields came from, on the page where it is reviewed and approved,
// so an admin sees which fields AI drafted before approving it. Products that weren't
// enriched (no record) show nothing.
const ProductEnrichmentWidget = ({ data }: { data?: { id: string; updated_at?: string | Date | null } }) => {
  const { t } = useTranslation()
  const productId = data?.id
  const { data: enrichment, isError } = useQuery({
    queryKey: ["product-enrichment", productId, String(data?.updated_at ?? "")],
    queryFn: async () => {
      try {
        // Mercur's client types this custom route's answer loosely.
        const { enrichment } = (await client.admin.products.$id.enrichment.query({ $id: productId! })) as unknown as {
          enrichment: Enrichment
        }
        return enrichment
      } catch (error) {
        if (error instanceof ClientError && error.status === 404) return null
        throw error
      }
    },
    enabled: !!productId,
  })
  if (!enrichment && !isError) return null

  const drafted = enrichment ? Object.entries(enrichment.fields).filter(([, from]) => from.drafted) : []
  const sourceName = (source: string) =>
    t(`catalogueEnrichment.sourceNames.${source}`, { defaultValue: source.replaceAll("_", " ") })

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("productEnrichment.title")}</Heading>
        {enrichment?.outcome && (
          <StatusBadge color={OUTCOME_COLOR[enrichment.outcome]}>
            {t(`catalogueEnrichment.filters.${enrichment.outcome}`)}
          </StatusBadge>
        )}
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {isError && (
          <Text size="small" className="text-ui-fg-error">
            {t("productEnrichment.loadError")}
          </Text>
        )}
        {drafted.length > 0 && (
          <Text size="small" weight="plus">
            {t("productEnrichment.draftedIntro")}
          </Text>
        )}
        {enrichment && (
          <ul className="flex flex-col gap-y-1">
            {Object.entries(enrichment.fields).map(([field, from]) => (
              <li key={field} className="txt-small text-ui-fg-subtle">
                {t(`catalogueEnrichment.fields.${field}`, field)}: {sourceName(from.source)}
                {from.drafted && (
                  <Tooltip content={t("catalogueEnrichment.aiDraftHint")}>
                    <Badge size="2xsmall" color="orange" className="ml-1">
                      {t("catalogueEnrichment.aiDraft")}
                    </Badge>
                  </Tooltip>
                )}
              </li>
            ))}
          </ul>
        )}
        {enrichment?.reasons.items.map((reason) => (
          <Text key={reason} size="small">
            {reason}
          </Text>
        ))}
      </div>
    </Container>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the zone from this export
export const config = defineWidgetConfig({
  zone: "product.detail.side.before",
})

export default ProductEnrichmentWidget
