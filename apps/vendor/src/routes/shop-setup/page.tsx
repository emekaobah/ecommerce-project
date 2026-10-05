import { CheckCircleSolid, ExclamationCircle, ShoppingBag } from "@medusajs/icons"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import type { RouteConfig } from "@mercurjs/dashboard-sdk"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { BankAccountForm } from "./bank-account-form"
import { PickupAddressForm } from "./pickup-address-form"
import { ONBOARDING_QUERY_KEY, useOnboarding, type Onboarding } from "./types"

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the sidebar entry from this export
export const config: RouteConfig = {
  label: "Shop setup",
  icon: ShoppingBag,
  rank: 0,
}

// eslint-disable-next-line react-refresh/only-export-components -- React Router reads the breadcrumb from this export
export const handle = {
  breadcrumb: () => "Shop setup",
}

/**
 * The shop's onboarding checklist (#26): buyers see its offers only once couriers can collect
 * from it (a pickup address Shipbubble validated) and Oja can pay it (a bank account Paystack
 * resolved). The API decides what is complete; this page shows it and takes the details.
 */
const ShopSetupPage = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data, isError } = useOnboarding()
  const saved = (onboarding: Onboarding) => queryClient.setQueryData(ONBOARDING_QUERY_KEY, onboarding)

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex flex-col gap-y-1">
            <Heading>{t("shopSetup.title")}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {t("shopSetup.description")}
            </Text>
          </div>
          {data && (
            <Badge size="2xsmall" color={data.is_live ? "green" : "orange"}>
              {t(data.is_live ? "shopSetup.live" : "shopSetup.notLive")}
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-y-2 px-6 py-4">
          {isError && (
            <Text size="small" className="text-ui-fg-error">
              {t("shopSetup.loadError")}
            </Text>
          )}
          {data && data.status !== "open" && (
            <Text size="small" className="text-ui-fg-subtle">
              {t(`shopSetup.status.${data.status}`, { defaultValue: t("shopSetup.status.other") })}
            </Text>
          )}
          {data?.steps.map((step) => (
            <div key={step.key} className="flex items-center gap-x-2">
              {step.is_complete ? (
                <CheckCircleSolid className="text-ui-fg-interactive" />
              ) : (
                <ExclamationCircle className="text-ui-fg-error" />
              )}
              <Text size="small">{t(`shopSetup.steps.${step.key}`)}</Text>
              {!step.is_complete && (
                <Text size="small" className="text-ui-fg-subtle">
                  {t("shopSetup.missing")}
                </Text>
              )}
            </div>
          ))}
        </div>
      </Container>
      {data && <PickupAddressForm onboarding={data} onSaved={saved} />}
      {data && <BankAccountForm onboarding={data} onSaved={saved} />}
    </div>
  )
}

export default ShopSetupPage
