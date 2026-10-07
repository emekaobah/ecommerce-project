import { addressFormValues, getAddressConfig, type AddressFieldKey, type AddressFormValues } from "@oja/domain"
import { Button, Container, Heading, Input, Label, Select, Text } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { client } from "../../lib/client"
import type { Onboarding } from "./types"

const METADATA = "metadata."

/** The form's values as the API takes a pickup address: Medusa's columns, the rest in `metadata`. */
function toAddress(values: AddressFormValues, countryCode: string) {
  const address: Record<string, string> = {}
  const metadata: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith(METADATA)) metadata[key.slice(METADATA.length)] = value ?? ""
    else address[key] = value ?? ""
  }
  return { ...address, country_code: countryCode, metadata }
}

/**
 * The shop's pickup address on its country's plain address form (`@oja/domain`). Saving
 * validates it with Shipbubble; an address couriers can't find is refused with the reason.
 * Search and a map pin come with #41 (ADR 0002).
 */
export const PickupAddressForm = ({
  onboarding,
  onSaved,
}: {
  onboarding: Onboarding
  onSaved: (onboarding: Onboarding) => void
}) => {
  const { t } = useTranslation()
  const countryCode = onboarding.country_code
  const config = countryCode ? getAddressConfig(countryCode) : null
  const [values, setValues] = useState<AddressFormValues>(() =>
    countryCode ? addressFormValues(onboarding.pickup_address, countryCode) : {}
  )
  const set = (key: AddressFieldKey, value: string) => setValues((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: async () => (await client.vendor.onboarding.pickupAddress.mutate(toAddress(values, countryCode!))).onboarding,
    onSuccess: onSaved,
  })
  const complete = onboarding.steps.find((s) => s.key === "pickup_address")?.is_complete

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{t("shopSetup.steps.pickup_address")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t(complete ? "shopSetup.pickup.validated" : "shopSetup.pickup.description")}
        </Text>
      </div>
      {!config && (
        <Text size="small" className="text-ui-fg-error px-6 py-4">
          {t("shopSetup.pickup.noCountry")}
        </Text>
      )}
      {config && (
        <form
          className="grid max-w-2xl grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          {config.fields.map((field) => {
            const id = `pickup-${field.key}`
            const value = values[field.key] ?? ""
            return (
              <div key={field.key} className="flex flex-col gap-y-2">
                <Label htmlFor={id} weight="plus">
                  {field.label}
                  {!field.required && (
                    <span className="text-ui-fg-muted font-normal"> ({t("shopSetup.optional")})</span>
                  )}
                </Label>
                {field.options ? (
                  <Select value={value} onValueChange={(next) => set(field.key, next)}>
                    <Select.Trigger id={id}>
                      <Select.Value placeholder={t("shopSetup.choose")} />
                    </Select.Trigger>
                    <Select.Content>
                      {field.options.map((option) => (
                        <Select.Item key={option} value={option}>
                          {option}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                ) : (
                  <Input
                    id={id}
                    value={value}
                    placeholder={field.key === "phone" ? config.phone.placeholder : field.placeholder}
                    onChange={(event) => set(field.key, event.target.value)}
                  />
                )}
              </div>
            )
          })}
          {save.isError && (
            <Text size="small" className="text-ui-fg-error md:col-span-2">
              {save.error.message}
            </Text>
          )}
          <div className="md:col-span-2">
            <Button type="submit" size="small" isLoading={save.isPending}>
              {t("shopSetup.pickup.save")}
            </Button>
          </div>
        </form>
      )}
    </Container>
  )
}
