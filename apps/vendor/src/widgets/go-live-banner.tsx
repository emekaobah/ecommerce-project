import { ExclamationCircle } from "@medusajs/icons"
import { Container, Text } from "@medusajs/ui"
import { defineWidgetConfig } from "@mercurjs/dashboard-sdk"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { client } from "../lib/client"
import { ONBOARDING_QUERY_KEY, type Onboarding } from "../routes/shop-setup/types"

// Until the shop is live, buyers can't see its offers (#26): say so where staff look at
// orders and offers, and link to what is missing.
const GoLiveBanner = () => {
  const { t } = useTranslation()
  const { data } = useQuery<Onboarding>({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: async () => (await client.vendor.onboarding.query()).onboarding,
  })
  if (!data || data.is_live) return null
  const missing = data.steps.filter((s) => !s.is_complete).map((s) => t(`shopSetup.steps.${s.key}`))

  return (
    <Container className="flex items-center gap-x-2 px-6 py-4">
      <ExclamationCircle className="text-ui-fg-error" />
      <Text size="small">
        {missing.length ? t("shopSetup.banner.missing", { items: missing.join(", ") }) : t("shopSetup.banner.waiting")}{" "}
        <Link to="/shop-setup" className="text-ui-fg-interactive">
          {t("shopSetup.banner.link")}
        </Link>
      </Text>
    </Container>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the zone from this export
export const config = defineWidgetConfig({
  zone: ["orders.list.before", "offers.list.before"],
})

export default GoLiveBanner
