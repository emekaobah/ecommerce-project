import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import type { InferClientOutput } from "@mercurjs/client"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { client } from "../lib/client"

type Costs = InferClientOutput<typeof client.vendor.offerCosts.query>

const money = (amount: number, currency: string) => `${currency.toUpperCase()} ${amount.toLocaleString()}`

// The shop's private cost on this offer, and a warning when it sells below it.
// The panel's offer page is the product's, so the costs are asked for by product.
// The API answers only owners and managers (GET /vendor/offer-costs); for
// fulfilment staff, and for offers with no cost, the widget shows nothing.
const OfferCostWidget = ({ data }: { data?: { id: string; updated_at?: string | Date | null } }) => {
  const { t } = useTranslation()
  const productId = data?.id
  const { data: costs } = useQuery<Costs>({
    queryKey: ["offer-cost", productId, String(data?.updated_at ?? "")],
    queryFn: () =>
      // Mercur's client types a route's body, not its query string.
      client.vendor.offerCosts.query({ product_id: productId } as { fetchOptions?: RequestInit }),
    enabled: !!productId,
    retry: false,
  })
  const cost = costs?.offer_costs[0]
  if (!cost) return null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">{t("offerCost.title")}</Heading>
        {cost.below_cost && (
          <Badge size="2xsmall" color="red">
            {t("offerCost.belowCost")}
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Text size="small">{t("offerCost.cost", { amount: money(cost.amount, cost.currency_code) })}</Text>
        {cost.below_cost && cost.price !== null && (
          <Text size="small" className="text-ui-fg-error">
            {t("offerCost.warning", { price: money(cost.price, cost.currency_code) })}
          </Text>
        )}
        <Text size="small" className="text-ui-fg-subtle">
          {t("offerCost.private")}
        </Text>
      </div>
    </Container>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the zone from this export
export const config = defineWidgetConfig({
  zone: "offers.detail.side.before",
})

export default OfferCostWidget
