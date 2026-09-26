import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import type { InferClientOutput } from "@mercurjs/client"
import { CheckCircleSolid, XCircleSolid } from "@medusajs/icons"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { client } from "../lib/client"

type Completeness = InferClientOutput<typeof client.admin.products.$id.completeness.query>["completeness"]

// Shows the publish gate's verdict for this product. The rule lives in the API
// (GET /admin/products/:id/completeness); this widget only displays it.
const ProductCompletenessWidget = ({ data }: { data?: { id: string; updated_at?: string | Date | null } }) => {
  const productId = data?.id
  const { data: completeness, isError } = useQuery<Completeness>({
    // Refetch whenever the product is saved.
    queryKey: ["product-completeness", productId, String(data?.updated_at ?? "")],
    queryFn: async () => (await client.admin.products.$id.completeness.query({ $id: productId! })).completeness,
    enabled: !!productId,
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Completeness</Heading>
        {completeness && (
          <Badge size="2xsmall" color={completeness.is_complete ? "green" : "orange"}>
            {completeness.score}%
          </Badge>
        )}
      </div>
      <div className="px-6 py-4">
        {isError && (
          <Text size="small" className="text-ui-fg-error">
            Could not load completeness.
          </Text>
        )}
        {!completeness && !isError && (
          <Text size="small" className="text-ui-fg-subtle">
            Loading…
          </Text>
        )}
        {completeness?.is_complete && (
          <div className="flex items-center gap-x-2">
            <CheckCircleSolid className="text-ui-fg-interactive" />
            <Text size="small">Ready to publish.</Text>
          </div>
        )}
        {completeness && !completeness.is_complete && (
          <div className="flex flex-col gap-y-2">
            <Text size="small" className="text-ui-fg-subtle">
              Add these before the product can be published:
            </Text>
            <ul className="flex flex-col gap-y-1">
              {completeness.missing.map((field) => (
                <li key={field.key} className="flex items-center gap-x-2">
                  <XCircleSolid className="text-ui-fg-error" />
                  <Text size="small">{field.label}</Text>
                </li>
              ))}
            </ul>
          </div>
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
