import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import type { InferClientOutput } from "@mercurjs/client"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { client } from "../lib/client"

type Authors = InferClientOutput<typeof client.vendor.offerAuthors.query>
type Author = Authors["offer_authors"][number]

// Who added the shop's offers on this product (#38). Fulfilment staff can add a
// product the shop doesn't sell yet by scanning it in the vendor app (quick-add);
// the owner sees here who did, to review the price and stock they set.
// The panel's offer page is the product's, so authors are asked for by product.
const OfferAuthorsWidget = ({ data }: { data?: { id: string; updated_at?: string | Date | null } }) => {
  const { t } = useTranslation()
  const productId = data?.id
  const { data: authors } = useQuery<Authors>({
    queryKey: ["offer-authors", productId, String(data?.updated_at ?? "")],
    queryFn: () =>
      // Mercur's client types a route's body, not its query string.
      client.vendor.offerAuthors.query({ product_id: productId } as { fetchOptions?: RequestInit }),
    enabled: !!productId,
    retry: false,
  })
  const offers = authors?.offer_authors ?? []
  if (!offers.length) return null

  const who = (author: Author) => author.added_by?.name ?? author.added_by?.email ?? t("offerAuthors.unknown")
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("offerAuthors.title")}</Heading>
      </div>
      {offers.map((author) => (
        <div key={author.offer_id} className="flex flex-col gap-y-1 px-6 py-4">
          <div className="flex items-center justify-between gap-x-2">
            <Text size="small" weight="plus">
              {t("offerAuthors.addedBy", { member: who(author) })}
            </Text>
            {author.added_with === "quick_add" && (
              <Badge size="2xsmall" color="orange">
                {t("offerAuthors.quickAdd")}
              </Badge>
            )}
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            {t("offerAuthors.details", { sku: author.sku, date: new Date(author.added_at).toLocaleDateString() })}
          </Text>
          {author.added_with === "quick_add" && (
            <Text size="small" className="text-ui-fg-subtle">
              {t("offerAuthors.review")}
            </Text>
          )}
        </div>
      ))}
    </Container>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the zone from this export
export const config = defineWidgetConfig({
  zone: "offers.detail.side.after",
})

export default OfferAuthorsWidget
