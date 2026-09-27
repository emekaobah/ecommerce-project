import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import type { InferClientOutput } from "@mercurjs/client"
import { CheckCircleSolid, XCircleSolid } from "@medusajs/icons"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { client } from "../lib/client"

type Report = InferClientOutput<typeof client.vendor.products.$id.completeness.query>

// Shows the publish gate's verdict for this product. The rule lives in the API
// (GET /vendor/products/:id/completeness); this widget only displays it. While
// the shop has a change request pending, the API reports the product as that
// request would leave it.
const ProductCompletenessWidget = ({ data }: { data?: { id: string; updated_at?: string | Date | null } }) => {
  const { t } = useTranslation()
  const productId = data?.id
  const { data: report, isError } = useQuery<Report>({
    queryKey: ["product-completeness", productId, String(data?.updated_at ?? "")],
    queryFn: () => client.vendor.products.$id.completeness.query({ $id: productId! }),
    enabled: !!productId,
  })
  const completeness = report?.completeness
  // Core checks have translations; attribute checks are named by the catalogue.
  const label = (field: { key: string; label: string }) =>
    t(`productCompleteness.fields.${field.key}`, { defaultValue: field.label })

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("productCompleteness.title")}</Heading>
        {completeness && (
          <Badge size="2xsmall" color={completeness.is_complete ? "green" : "orange"}>
            {completeness.score}%
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {isError && (
          <Text size="small" className="text-ui-fg-error">
            {t("productCompleteness.loadError")}
          </Text>
        )}
        {!completeness && !isError && (
          <Text size="small" className="text-ui-fg-subtle">
            {t("productCompleteness.loading")}
          </Text>
        )}
        {report?.pending_change && (
          <Text size="small" className="text-ui-fg-subtle">
            {t("productCompleteness.pendingNote")}
          </Text>
        )}
        {completeness?.is_complete && (
          <div className="flex items-center gap-x-2">
            <CheckCircleSolid className="text-ui-fg-interactive" />
            <Text size="small">{t("productCompleteness.ready")}</Text>
          </div>
        )}
        {completeness && !completeness.is_complete && (
          <>
            <Text size="small" className="text-ui-fg-subtle">
              {t("productCompleteness.missingIntro")}
            </Text>
            <ul className="flex flex-col gap-y-1">
              {completeness.missing.map((field) => (
                <li key={field.key} className="flex items-center gap-x-2">
                  <XCircleSolid className="text-ui-fg-error" />
                  <Text size="small">{label(field)}</Text>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Container>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the zone from this export
export const config = defineWidgetConfig({
  zone: "product.detail.side.before",
})

export default ProductCompletenessWidget
