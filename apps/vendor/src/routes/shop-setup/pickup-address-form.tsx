import {
  addressFormValues,
  addressFromForm,
  formFromLookup,
  getAddressConfig,
  mapCentre,
  pinOf,
  type AddressConfig,
  type AddressFieldKey,
  type AddressFormErrors,
  type AddressFormValues,
  type LookedUpPlace,
  type Pin,
} from "@oja/domain"
import { Button, Container, Heading, Input, Label, Select, Text } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { client } from "../../lib/client"
import {
  currentPosition,
  MIN_SEARCH_LENGTH,
  newLookupSession,
  useAddressAt,
  useAddressSuggestions,
  useDebouncedValue,
  usePlaceAddress,
} from "./address-lookup"
import { PinMap, type PinRequest } from "./pin-map"
import type { Onboarding } from "./types"

const METADATA = "metadata."

/** The form's values and the confirmed pin as the API takes a pickup address: Medusa's columns, the rest in `metadata`. */
function toAddress(values: AddressFormValues, countryCode: string, pin: Pin) {
  const address: Record<string, string> = {}
  const metadata: Record<string, string | number> = { ...pin }
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith(METADATA)) metadata[key.slice(METADATA.length)] = value ?? ""
    else address[key] = value ?? ""
  }
  return { ...address, country_code: countryCode, metadata }
}

/**
 * The shop's pickup address (ADR 0002, #41): found with Google search or the browser's location,
 * which fills the country's form (`@oja/domain`); then the owner confirms or drags a pin on the
 * map. "Enter it by hand" is the plain form, but the pin is still placed before saving. Saving
 * validates it with Shipbubble by the pin and the address; one couriers can't find is refused
 * with the reason.
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

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{t("shopSetup.steps.pickup_address")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t(
            onboarding.steps.find((s) => s.key === "pickup_address")?.is_complete
              ? "shopSetup.pickup.validated"
              : "shopSetup.pickup.description"
          )}
        </Text>
      </div>
      {config ? (
        <PickupAddressEntry config={config} onboarding={onboarding} onSaved={onSaved} />
      ) : (
        <Text size="small" className="text-ui-fg-error px-6 py-4">
          {t("shopSetup.pickup.noCountry")}
        </Text>
      )}
    </Container>
  )
}

const PickupAddressEntry = ({
  config,
  onboarding,
  onSaved,
}: {
  config: AddressConfig
  onboarding: Onboarding
  onSaved: (onboarding: Onboarding) => void
}) => {
  const { t } = useTranslation()
  const saved = onboarding.pickup_address
  const [values, setValues] = useState<AddressFormValues>(() => addressFormValues(saved, config.countryCode))
  const [errors, setErrors] = useState<AddressFormErrors>({})
  const [pin, setPin] = useState<Pin | null>(() => pinOf(saved))
  const [mode, setMode] = useState<"search" | "form">(saved?.address_1 ? "form" : "search")
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null)
  // Saving waits for the pin when the owner hasn't placed one yet.
  const [saveOnConfirm, setSaveOnConfirm] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const addressAt = useAddressAt()

  const save = useMutation({
    mutationFn: async (confirmed: Pin) =>
      (await client.vendor.onboarding.pickupAddress.mutate(toAddress(values, config.countryCode, confirmed))).onboarding,
    onSuccess: onSaved,
  })

  const set = (key: AddressFieldKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      const rest = { ...current }
      delete rest[key]
      return rest
    })
  }

  /** A new place: its address fills the form, and the old pin no longer marks it. */
  const fill = (place: LookedUpPlace | null) => {
    if (place) setValues((current) => ({ ...current, ...formFromLookup(place, config.countryCode) }))
    setErrors({})
    setPin(null)
    setMode("form")
  }

  const locateMe = async () => {
    setNotice(null)
    setLocating(true)
    try {
      const here = await currentPosition()
      if (!here) {
        setNotice(t("shopSetup.pickup.locationOff"))
        return
      }
      let place: LookedUpPlace | null = null
      try {
        place = await addressAt.mutateAsync(here)
        if (!place) setNotice(t("shopSetup.pickup.nothingHere"))
      } catch (error) {
        setNotice(t("shopSetup.pickup.lookupError", { message: (error as Error).message }))
      }
      fill(place)
      // The pin starts where the owner is, not at the address Google found nearby.
      setPinRequest({ at: here, zoom: "place" })
    } finally {
      setLocating(false)
    }
  }

  /** The map for a pin placed by hand: where the owner is, else their state, else the country. */
  const placePinByHand = async () => {
    const here = await currentPosition()
    if (here) return setPinRequest({ at: here, zoom: "place" })
    const { zoom, ...centre } = mapCentre(values.province, config.countryCode)
    setPinRequest({ at: centre, zoom })
  }

  const submit = () => {
    const checked = addressFromForm(values, config.countryCode)
    if (!checked.ok) return setErrors(checked.errors)
    if (pin) return save.mutate(pin)
    setSaveOnConfirm(true)
    void placePinByHand()
  }

  const confirmPin = (confirmed: Pin) => {
    setPinRequest(null)
    setPin(confirmed)
    if (saveOnConfirm) {
      setSaveOnConfirm(false)
      save.mutate(confirmed)
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-y-4 px-6 py-4">
      {mode === "search" && (
        <>
          <AddressSearch
            onFound={(place) => {
              setNotice(null)
              fill(place)
              setPinRequest({ at: place.location, zoom: "place" })
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="small" variant="secondary" isLoading={locating} onClick={() => void locateMe()}>
              {t("shopSetup.pickup.useLocation")}
            </Button>
            <Button type="button" size="small" variant="transparent" onClick={() => setMode("form")}>
              {t("shopSetup.pickup.enterManually")}
            </Button>
          </div>
        </>
      )}
      {notice && (
        <Text size="small" className="text-ui-fg-subtle" aria-live="polite">
          {notice}
        </Text>
      )}
      {mode === "form" && (
        <form
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="md:col-span-2">
            <Button
              type="button"
              size="small"
              variant="transparent"
              onClick={() => {
                setPinRequest(null)
                setMode("search")
              }}
            >
              {t("shopSetup.pickup.searchAgain")}
            </Button>
          </div>
          {config.fields.map((field) => {
            const id = `pickup-${field.key}`
            const value = values[field.key] ?? ""
            const error = errors[field.key]
            return (
              <div key={field.key} className="flex flex-col gap-y-2">
                <Label htmlFor={id} weight="plus">
                  {field.label}
                  {!field.required && <span className="text-ui-fg-muted font-normal"> ({t("shopSetup.optional")})</span>}
                </Label>
                {field.options ? (
                  <Select value={value} onValueChange={(next) => set(field.key, next)}>
                    <Select.Trigger id={id} aria-invalid={!!error}>
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
                    aria-invalid={!!error}
                    placeholder={field.key === "phone" ? config.phone.placeholder : field.placeholder}
                    onChange={(event) => set(field.key, event.target.value)}
                  />
                )}
                {error && (
                  <Text size="small" className="text-ui-fg-error">
                    {error}
                  </Text>
                )}
              </div>
            )
          })}
          {pinRequest ? (
            <PinMap
              key={`${pinRequest.at.latitude},${pinRequest.at.longitude},${pinRequest.zoom}`}
              request={pinRequest}
              onConfirm={confirmPin}
              onCancel={() => {
                setPinRequest(null)
                setSaveOnConfirm(false)
              }}
            />
          ) : (
            <div className="flex items-center gap-x-2 md:col-span-2">
              <Text size="small" className="text-ui-fg-subtle">
                {t(pin ? "shopSetup.pickup.pinPlaced" : "shopSetup.pickup.pinToPlace")}
              </Text>
              <Button
                type="button"
                size="small"
                variant="transparent"
                onClick={() => (pin ? setPinRequest({ at: pin, zoom: "place" }) : void placePinByHand())}
              >
                {t(pin ? "shopSetup.pickup.movePin" : "shopSetup.pickup.placePin")}
              </Button>
            </div>
          )}
          {save.isError && (
            <Text size="small" className="text-ui-fg-error md:col-span-2" aria-live="polite">
              {save.error.message}
            </Text>
          )}
          <div className="md:col-span-2">
            <Button type="submit" size="small" isLoading={save.isPending} disabled={!!pinRequest}>
              {t("shopSetup.pickup.save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

/** Google's suggestions as the owner types; choosing one looks up its address. */
const AddressSearch = ({ onFound }: { onFound: (place: LookedUpPlace) => void }) => {
  const { t } = useTranslation()
  const [input, setInput] = useState("")
  const [session, setSession] = useState(newLookupSession)
  const settled = useDebouncedValue(input, 300)
  const suggestions = useAddressSuggestions(session, settled)
  const placeAddress = usePlaceAddress()

  const choose = (placeId: string) =>
    placeAddress.mutate(
      { placeId, sessionToken: session },
      {
        onSuccess: (place) => {
          // A chosen place ends Google's session; the next search starts another.
          setSession(newLookupSession())
          setInput("")
          onFound(place)
        },
      }
    )

  const error = placeAddress.error ?? suggestions.error
  const list = settled.trim().length >= MIN_SEARCH_LENGTH ? suggestions.data : undefined
  return (
    <div className="flex flex-col gap-y-2">
      <Label htmlFor="pickup-search" weight="plus">
        {t("shopSetup.pickup.search")}
      </Label>
      <Input
        id="pickup-search"
        type="search"
        autoComplete="off"
        value={input}
        placeholder={t("shopSetup.pickup.searchPlaceholder")}
        onChange={(event) => setInput(event.target.value)}
      />
      {placeAddress.isPending && (
        <Text size="small" className="text-ui-fg-subtle" aria-live="polite">
          {t("shopSetup.pickup.finding")}
        </Text>
      )}
      {!list && suggestions.isFetching && (
        <Text size="small" className="text-ui-fg-subtle">
          {t("shopSetup.pickup.searching")}
        </Text>
      )}
      {!!list?.length && (
        <ul className="divide-y rounded-lg border">
          {list.map((suggestion) => (
            <li key={suggestion.place_id}>
              <button
                type="button"
                className="hover:bg-ui-bg-base-hover flex w-full flex-col px-3 py-2 text-left"
                onClick={() => choose(suggestion.place_id)}
              >
                <Text size="small" weight="plus">
                  {suggestion.main_text}
                </Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {suggestion.secondary_text}
                </Text>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list?.length === 0 && (
        <Text size="small" className="text-ui-fg-subtle">
          {t("shopSetup.pickup.noMatches")}
        </Text>
      )}
      {!!list?.length && (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("shopSetup.pickup.poweredByGoogle")}
        </Text>
      )}
      {error && (
        <Text size="small" className="text-ui-fg-error" aria-live="polite">
          {t("shopSetup.pickup.lookupError", { message: error.message })}
        </Text>
      )}
    </div>
  )
}
