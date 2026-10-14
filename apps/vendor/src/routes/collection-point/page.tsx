import { getAddressConfig } from "@oja/domain"
import { MapPin } from "@medusajs/icons"
import { Button, Checkbox, Container, Heading, Input, Label, Text, Textarea } from "@medusajs/ui"
import type { InferClientInput, InferClientOutput } from "@mercurjs/client"
import type { RouteConfig } from "@mercurjs/dashboard-sdk"
import { PermissionGuard } from "@mercurjs/dashboard-shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { client } from "../../lib/client"
import { AddressEntry } from "../shop-setup/pickup-address-form"
import { useOnboarding } from "../shop-setup/types"

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the sidebar entry from this export
export const config: RouteConfig = {
  label: "Pickup",
  icon: MapPin,
  rank: 2,
}

// eslint-disable-next-line react-refresh/only-export-components -- React Router reads the breadcrumb from this export
export const handle = {
  breadcrumb: () => "Pickup",
}

type CollectionPoint = InferClientOutput<typeof client.vendor.collectionPoint.query>
type CollectionPointInput = InferClientInput<typeof client.vendor.collectionPoint.mutate>

const QUERY_KEY = ["collection-point"]

/**
 * In-store pickup (#12): a shop offers its buyers pickup by setting a collection point, open the
 * shop's own hours, so only once it has opening hours. By default it is the pickup address (and
 * ticking it agrees to show that address to buyers); unticked, a separate address found and
 * pinned like the pickup address, which no courier visits. Every member sees it; owners and
 * managers set it.
 */
const CollectionPointPage = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data, isError } = useQuery<CollectionPoint>({
    queryKey: QUERY_KEY,
    queryFn: () => client.vendor.collectionPoint.query(),
  })

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="flex flex-col gap-y-2 px-6 py-4">
        <Heading>{t("collectionPoint.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t(data?.collection_point ? "collectionPoint.offered" : "collectionPoint.description")}
        </Text>
        {isError && (
          <Text size="small" className="text-ui-fg-error">
            {t("collectionPoint.loadError")}
          </Text>
        )}
      </Container>
      {data && !data.has_hours && (
        <Container className="flex flex-col gap-y-2 px-6 py-4">
          <Text size="small" className="text-ui-fg-error">
            {t("collectionPoint.needsHours")}
          </Text>
          <Link to="/shop-hours" className="text-ui-fg-interactive txt-compact-small-plus">
            {t("collectionPoint.setHours")}
          </Link>
        </Container>
      )}
      {data?.has_hours && (
        <PermissionGuard
          resource="seller"
          operation="update"
          showLoading
          fallback={
            <Container className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle">
                {t("collectionPoint.askAnOwner")}
              </Text>
            </Container>
          }
        >
          <CollectionPointForm
            key={JSON.stringify(data.collection_point)}
            saved={data.collection_point}
            onSaved={(next) => queryClient.setQueryData<CollectionPoint>(QUERY_KEY, next)}
          />
        </PermissionGuard>
      )}
    </div>
  )
}

const CollectionPointForm = ({
  saved,
  onSaved,
}: {
  saved: CollectionPoint["collection_point"]
  onSaved: (point: CollectionPoint) => void
}) => {
  const { t } = useTranslation()
  const onboarding = useOnboarding()
  const [follows, setFollows] = useState(saved?.follows_pickup_address ?? true)
  const [instructions, setInstructions] = useState(saved?.instructions ?? "")
  const [phone, setPhone] = useState(saved?.phone ?? "")
  const save = useMutation({
    mutationFn: async (address?: CollectionPointInput["address"]) =>
      client.vendor.collectionPoint.mutate({
        follows_pickup_address: !address,
        address: address ?? null,
        instructions,
        phone: phone.trim() || null,
      }),
    onSuccess: onSaved,
  })
  const remove = useMutation({
    mutationFn: () => client.vendor.collectionPoint.delete(),
    onSuccess: onSaved,
  })
  const countryCode = onboarding.data?.country_code
  const addressConfig = countryCode ? getAddressConfig(countryCode) : null

  return (
    <Container className="flex max-w-2xl flex-col gap-y-4 px-6 py-4">
      <div className="flex items-start gap-x-2">
        <Checkbox id="follows" checked={follows} onCheckedChange={(checked) => setFollows(checked === true)} />
        <div className="flex flex-col gap-y-1">
          <Label htmlFor="follows" weight="plus">
            {t("collectionPoint.usePickupAddress")}
          </Label>
          <Text size="small" className="text-ui-fg-subtle">
            {t("collectionPoint.consent")}
          </Text>
        </div>
      </div>
      <div className="flex flex-col gap-y-2">
        <Label htmlFor="instructions" weight="plus">
          {t("collectionPoint.instructions")}
        </Label>
        <Textarea
          id="instructions"
          value={instructions}
          placeholder={t("collectionPoint.instructionsPlaceholder")}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-y-2">
        <Label htmlFor="phone" weight="plus">
          {t("collectionPoint.phone")} <span className="text-ui-fg-muted font-normal">({t("shopSetup.optional")})</span>
        </Label>
        <Input id="phone" value={phone} placeholder={addressConfig?.phone.placeholder} onChange={(event) => setPhone(event.target.value)} />
      </div>
      <Text size="small" className="text-ui-fg-subtle">
        {t("collectionPoint.hours")}
      </Text>
      {save.isError && (
        <Text size="small" className="text-ui-fg-error" aria-live="polite">
          {save.error.message}
        </Text>
      )}
      {follows ? (
        <div>
          <Button size="small" isLoading={save.isPending} disabled={!instructions.trim()} onClick={() => save.mutate(undefined)}>
            {t("collectionPoint.save")}
          </Button>
        </div>
      ) : addressConfig ? (
        <div className="-mx-6 flex flex-col gap-y-2 border-t pt-4">
          <Text size="small" weight="plus" className="px-6">
            {t("collectionPoint.address")}
          </Text>
          <AddressEntry
            config={addressConfig}
            saved={
              saved && !saved.follows_pickup_address
                ? { ...saved.address, metadata: { landmark: saved.address.landmark } }
                : null
            }
            omit={["first_name", "last_name", "phone"]}
            saveLabel={t("collectionPoint.save")}
            pinLabels={{ title: t("collectionPoint.pin.title"), help: t("collectionPoint.pin.help") }}
            onSave={(address) => save.mutateAsync(address)}
          />
        </div>
      ) : (
        <Text size="small" className="text-ui-fg-error">
          {t("shopSetup.pickup.noCountry")}
        </Text>
      )}
      {saved && (
        <div className="flex flex-col gap-y-2 border-t pt-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t("collectionPoint.removeHelp")}
          </Text>
          {remove.isError && (
            <Text size="small" className="text-ui-fg-error" aria-live="polite">
              {remove.error.message}
            </Text>
          )}
          <div>
            <Button size="small" variant="danger" isLoading={remove.isPending} onClick={() => remove.mutate()}>
              {t("collectionPoint.remove")}
            </Button>
          </div>
        </div>
      )}
    </Container>
  )
}

export default CollectionPointPage
