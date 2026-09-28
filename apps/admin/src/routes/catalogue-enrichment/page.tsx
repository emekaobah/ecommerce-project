import { Sparkles } from "@medusajs/icons"
import { Container, Heading, StatusBadge, Table, Tabs, Text } from "@medusajs/ui"
import type { RouteConfig } from "@mercurjs/dashboard-sdk"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { client } from "../../lib/client"

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the sidebar entry from this export
export const config: RouteConfig = {
  label: "Enrichment",
  icon: Sparkles,
  // The sidebar matches this against the parent item's path, not its id.
  nested: "/products",
}

// eslint-disable-next-line react-refresh/only-export-components -- React Router reads the breadcrumb from this export
export const handle = {
  breadcrumb: () => "Enrichment",
}

type Outcome = "published" | "needs_review" | "incomplete"
type Provenance = { source: string; url: string | null }
type Enrichment = {
  id: string
  status: "queued" | "done" | "failed"
  outcome: Outcome | null
  fields: Record<string, Provenance>
  reasons: { items: string[] }
  errors: { items: string[] }
  enriched_at: string | null
  product: { id: string; title: string; status: string } | null
}

const FILTERS = ["published", "needs_review", "incomplete", "queued", "failed"] as const
type Filter = (typeof FILTERS)[number]
const OUTCOME_COLOR = { published: "green", needs_review: "orange", incomplete: "grey" } as const

/**
 * What background enrichment did to imported products: what it auto-published
 * (to spot-check), sent for review, or left incomplete, and where each field came from.
 */
const CatalogueEnrichmentPage = () => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>("published")
  const query = filter === "queued" || filter === "failed" ? { status: filter } : { outcome: filter }
  const enrichments = useQuery({
    queryKey: ["catalogue-enrichment", filter],
    // Mercur's client types a route's body, not its query string, and its route answers untyped rows.
    queryFn: () =>
      client.admin.catalogueEnrichment.query(query as { fetchOptions?: RequestInit }) as unknown as Promise<{
        enrichments: Enrichment[]
        count: number
      }>,
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading>{t("catalogueEnrichment.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("catalogueEnrichment.description")}
        </Text>
      </div>
      <div className="px-6 py-4">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <Tabs.List>
            {FILTERS.map((f) => (
              <Tabs.Trigger key={f} value={f}>
                {t(`catalogueEnrichment.filters.${f}`)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs>
      </div>
      <div className="px-6 py-4">
        {enrichments.isError && (
          <Text size="small" className="text-ui-fg-error">
            {t("catalogueEnrichment.loadError")}
          </Text>
        )}
        {enrichments.data && !enrichments.data.enrichments.length && (
          <Text size="small" className="text-ui-fg-subtle">
            {t("catalogueEnrichment.empty")}
          </Text>
        )}
        {enrichments.data && enrichments.data.enrichments.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("catalogueEnrichment.product")}</Table.HeaderCell>
                <Table.HeaderCell>{t("catalogueEnrichment.outcome")}</Table.HeaderCell>
                <Table.HeaderCell>{t("catalogueEnrichment.sources")}</Table.HeaderCell>
                <Table.HeaderCell>{t("catalogueEnrichment.notes")}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {enrichments.data.enrichments.map((e) => (
                <Table.Row key={e.id} className="h-auto align-top">
                  <Table.Cell>
                    {e.product ? (
                      <Link to={`/products/${e.product.id}`} className="text-ui-fg-interactive hover:underline">
                        {e.product.title}
                      </Link>
                    ) : (
                      "–"
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {e.outcome ? (
                      <StatusBadge color={OUTCOME_COLOR[e.outcome]}>{t(`catalogueEnrichment.filters.${e.outcome}`)}</StatusBadge>
                    ) : (
                      <StatusBadge color={e.status === "failed" ? "red" : "blue"}>
                        {t(`catalogueEnrichment.filters.${e.status}`)}
                      </StatusBadge>
                    )}
                  </Table.Cell>
                  <Table.Cell className="whitespace-normal">
                    <ul className="text-ui-fg-subtle txt-small">
                      {Object.entries(e.fields).map(([field, from]) => (
                        <li key={field}>
                          {t(`catalogueEnrichment.fields.${field}`, field)}:{" "}
                          {from.url ? (
                            <a href={from.url} target="_blank" rel="noreferrer" className="text-ui-fg-interactive hover:underline">
                              {sourceName(t, from.source)}
                            </a>
                          ) : (
                            sourceName(t, from.source)
                          )}
                        </li>
                      ))}
                    </ul>
                  </Table.Cell>
                  <Table.Cell className="whitespace-normal">
                    <ul className="txt-small">
                      {e.reasons.items.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                      {e.errors.items.map((error) => (
                        <li key={error} className="text-ui-fg-error">
                          {error}
                        </li>
                      ))}
                    </ul>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}

const sourceName = (t: (key: string, fallback: string) => string, source: string) =>
  t(`catalogueEnrichment.sourceNames.${source}`, source.replaceAll("_", " "))

export default CatalogueEnrichmentPage
