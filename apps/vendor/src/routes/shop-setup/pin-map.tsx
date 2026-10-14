import type { Pin } from "@oja/domain"
import { Button, Text } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

// The pickup pin, confirmed on a Google Maps JavaScript map (ADR 0002, #41). The pin is the
// location of record: Shipbubble validates the address by it, and couriers go there.

/** Where the map opens and how close: a place, a state, or the whole country. */
export type PinRequest = { at: Pin; zoom: "place" | "state" | "country" }

const ZOOM: Record<PinRequest["zoom"], number> = { place: 17, state: 9, country: 6 }

/** The browser key for Maps JavaScript (HTTP-referrer restricted), baked in at build time. */
const MAPS_KEY: string | undefined = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY

// The few parts of Maps JavaScript the pin uses; the app carries no @types/google.maps.
type LatLngLiteral = { lat: number; lng: number }
type MapsEvent = { latLng?: { lat(): number; lng(): number } | null }
type GoogleMap = { addListener(event: "click", handler: (event: MapsEvent) => void): unknown }
type GoogleMarker = {
  setPosition(position: LatLngLiteral): void
  getPosition(): { lat(): number; lng(): number } | null | undefined
  addListener(event: "dragend", handler: () => void): unknown
}
type MapsApi = {
  importLibrary(name: "maps"): Promise<{ Map: new (element: HTMLElement, options: object) => GoogleMap }>
  importLibrary(name: "marker"): Promise<{ Marker: new (options: object) => GoogleMarker }>
}
type GoogleWindow = Window & { google?: { maps?: MapsApi }; __ojaMapsReady?: () => void }

let loading: Promise<MapsApi> | undefined

/** Loads Maps JavaScript once for the page. */
function loadMaps(key: string): Promise<MapsApi> {
  const win = window as GoogleWindow
  loading ??= new Promise<MapsApi>((resolve, reject) => {
    if (win.google?.maps) return resolve(win.google.maps)
    win.__ojaMapsReady = () => resolve(win.google!.maps!)
    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__ojaMapsReady`
    script.async = true
    script.onerror = () => {
      loading = undefined
      script.remove()
      reject(new Error("Google Maps didn't load"))
    }
    document.head.appendChild(script)
  })
  return loading
}

const toPin = (position: { lat(): number; lng(): number }): Pin => ({ latitude: position.lat(), longitude: position.lng() })

/**
 * A map at the request, with a pin the owner drags (or clicks the map to move) to the place, then
 * confirms. `labels` says what the pin marks: by default, where couriers collect from the shop.
 */
export const PinMap = ({
  request,
  onConfirm,
  onCancel,
  labels,
}: {
  request: PinRequest
  onConfirm: (pin: Pin) => void
  onCancel: () => void
  labels?: { title: string; help: string }
}) => {
  const { t } = useTranslation()
  const element = useRef<HTMLDivElement>(null)
  const [pin, setPin] = useState<Pin>(request.at)
  const [failed, setFailed] = useState(!MAPS_KEY)

  // Mounted per request (the form keys it by the request), so the pin starts at `request.at`.
  useEffect(() => {
    if (!MAPS_KEY || !element.current) return
    let cancelled = false
    const mapElement = element.current
    loadMaps(MAPS_KEY)
      .then(async (maps) => {
        const [{ Map }, { Marker }] = await Promise.all([maps.importLibrary("maps"), maps.importLibrary("marker")])
        if (cancelled) return
        const position = { lat: request.at.latitude, lng: request.at.longitude }
        const map = new Map(mapElement, {
          center: position,
          zoom: ZOOM[request.zoom],
          streetViewControl: false,
          mapTypeControl: false,
          clickableIcons: false,
        })
        const marker = new Marker({ map, position, draggable: true })
        marker.addListener("dragend", () => {
          const moved = marker.getPosition()
          if (moved) setPin(toPin(moved))
        })
        map.addListener("click", ({ latLng }) => {
          if (!latLng) return
          marker.setPosition({ lat: latLng.lat(), lng: latLng.lng() })
          setPin(toPin(latLng))
        })
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [request])

  return (
    <div className="flex flex-col gap-y-3 md:col-span-2">
      <Text size="small" weight="plus">
        {labels?.title ?? t("shopSetup.pickup.pin.title")}
      </Text>
      <Text size="small" className="text-ui-fg-subtle">
        {labels?.help ?? t("shopSetup.pickup.pin.help")}
      </Text>
      {failed ? (
        <Text size="small" className="text-ui-fg-error">
          {t("shopSetup.pickup.pin.unavailable")}
        </Text>
      ) : (
        <div ref={element} className="bg-ui-bg-subtle h-80 w-full rounded-lg" data-testid="pickup-pin-map" />
      )}
      <div className="flex gap-x-2">
        <Button type="button" size="small" disabled={failed} onClick={() => onConfirm(pin)}>
          {t("shopSetup.pickup.pin.confirm")}
        </Button>
        <Button type="button" size="small" variant="secondary" onClick={onCancel}>
          {t("shopSetup.pickup.pin.cancel")}
        </Button>
      </div>
    </div>
  )
}
