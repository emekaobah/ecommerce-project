import { Clock } from "@medusajs/icons"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import type { RouteConfig } from "@mercurjs/dashboard-sdk"
import { PermissionGuard } from "@mercurjs/dashboard-shared"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ONBOARDING_QUERY_KEY } from "../shop-setup/types"
import { ExceptionsForm } from "./exceptions-form"
import { SHOP_HOURS_QUERY_KEY, useShopHours, type ShopHours } from "./types"
import { WeeklyHoursForm } from "./weekly-hours-form"

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the sidebar entry from this export
export const config: RouteConfig = {
  label: "Opening hours",
  icon: Clock,
  rank: 1,
}

// eslint-disable-next-line react-refresh/only-export-components -- React Router reads the breadcrumb from this export
export const handle = {
  breadcrumb: () => "Opening hours",
}

/**
 * The shop's opening hours (ADR 0004): weekly hours, which the shop must set before it goes
 * live, and planned exceptions. Pausing orders is done in the vendor app. Every member sees
 * them; only owners and managers get the forms, and the API refuses the rest.
 */
const ShopHoursPage = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data, isError } = useShopHours()
  const saved = (hours: ShopHours) => {
    queryClient.setQueryData(SHOP_HOURS_QUERY_KEY, hours)
    // Setting weekly hours completes an onboarding step.
    void queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY })
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="flex flex-col gap-y-2 px-6 py-4">
        <div className="flex items-center justify-between">
          <Heading>{t("shopHours.title")}</Heading>
          {data?.status && (
            <Badge size="2xsmall" color={data.status.state === "open" ? "green" : data.status.orderable ? "orange" : "red"}>
              {data.status.label}
            </Badge>
          )}
        </div>
        <Text size="small" className="text-ui-fg-subtle">
          {t("shopHours.description")}
        </Text>
        {isError && (
          <Text size="small" className="text-ui-fg-error">
            {t("shopHours.loadError")}
          </Text>
        )}
        {data && !data.weekly && (
          <Text size="small" className="text-ui-fg-error">
            {t("shopHours.notSet")}
          </Text>
        )}
        {data?.pause && (
          <Text size="small">
            {t(data.pause.ends_at ? "shopHours.pausedUntil" : "shopHours.paused", {
              until: data.pause.ends_at ? new Date(data.pause.ends_at).toLocaleString() : undefined,
            })}
          </Text>
        )}
      </Container>
      {data && (
        <PermissionGuard
          resource="seller"
          operation="update"
          showLoading
          fallback={
            <Container className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle">
                {t("shopHours.askAnOwner")}
              </Text>
            </Container>
          }
        >
          {/* Keyed by the saved hours, so the form starts again from what was saved. */}
          <WeeklyHoursForm key={JSON.stringify(data.weekly)} hours={data} onSaved={saved} />
          <ExceptionsForm hours={data} onSaved={saved} />
        </PermissionGuard>
      )}
    </div>
  )
}

export default ShopHoursPage
