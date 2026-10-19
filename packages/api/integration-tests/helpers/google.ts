import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server } from "node:http"

type Component = { longText: string; shortText: string; types: string[] }
/** A place the fake knows, as Places API (New) describes it. */
export type FakePlace = {
  id: string
  /** What autocomplete suggests it as. */
  main: string
  secondary: string
  formattedAddress: string
  location: { latitude: number; longitude: number }
  addressComponents: Component[]
}

const component = (longText: string, types: string[], shortText = longText): Component => ({
  longText,
  shortText,
  types: [...types, ...(types.includes("street_number") || types.includes("route") || types.includes("postal_code") ? [] : ["political"])],
})

/** Places as Google returned them in the check of 2026-10-04 (ADR 0002), and one across the border. */
export const PLACES = {
  victoriaIsland: {
    id: "ChIJ-victoria-island",
    main: "3 Akin Adesola Street",
    secondary: "Victoria Island, Lagos, Nigeria",
    formattedAddress: "3 Akin Adesola St, Victoria Island, Lagos 106104, Lagos, Nigeria",
    location: { latitude: 6.4318, longitude: 3.4215 },
    addressComponents: [
      component("3", ["street_number"]),
      component("Akin Adesola Street", ["route"], "Akin Adesola St"),
      component("Victoria Island", ["neighborhood"]),
      component("Lagos", ["locality"]),
      component("Ikoyi I", ["administrative_area_level_3"]),
      component("Eti Osa", ["administrative_area_level_2"]),
      component("Lagos", ["administrative_area_level_1"], "LA"),
      component("Nigeria", ["country"], "NG"),
      component("106104", ["postal_code"]),
    ],
  },
  transAmadi: {
    id: "ChIJ-trans-amadi",
    main: "Trans Amadi",
    secondary: "Port Harcourt, Nigeria",
    formattedAddress: "Trans Amadi, Port Harcourt, Rivers, Nigeria",
    location: { latitude: 4.8085, longitude: 7.0383 },
    addressComponents: [
      component("Trans Amadi", ["neighborhood"]),
      component("Port Harcourt", ["locality"]),
      component("Worji", ["administrative_area_level_3"]),
      component("Obio/Akpor", ["administrative_area_level_2"]),
      component("Rivers", ["administrative_area_level_1"], "RV"),
      component("Nigeria", ["country"], "NG"),
    ],
  },
  accra: {
    id: "ChIJ-osu-accra",
    main: "Oxford Street",
    secondary: "Osu, Accra, Ghana",
    formattedAddress: "Oxford St, Accra, Ghana",
    location: { latitude: 5.5571, longitude: -0.1818 },
    addressComponents: [
      component("Oxford Street", ["route"], "Oxford St"),
      component("Osu", ["neighborhood"]),
      component("Accra", ["locality"]),
      component("Greater Accra Region", ["administrative_area_level_1"], "GA"),
      component("Ghana", ["country"], "GH"),
    ],
  },
} satisfies Record<string, FakePlace>

export type AutocompleteRequest = { input: string; sessionToken?: string; includedRegionCodes?: string[] }
export type DetailsRequest = { placeId: string; fieldMask: string | undefined; sessionToken: string | null }
export type ReverseGeocodeRequest = { latlng: string | null }

/**
 * Stands in for Google's Places API (New) and Geocoding API: the backend's `GOOGLE_PLACES_API_URL`
 * and `GOOGLE_GEOCODING_API_URL` point here. It suggests and describes `PLACES`, reverse geocodes
 * a point to the nearest of them, and records every request for tests to inspect.
 */
export function fakeGoogle(
  port: number,
  {
    apiKey = `AIza${randomUUID().replaceAll("-", "")}`,
  }: {
    /** The API key the backend must send; a fresh one by default. */
    apiKey?: string
  } = {}
) {
  const autocompletes: AutocompleteRequest[] = []
  const details: DetailsRequest[] = []
  const reverseGeocodes: ReverseGeocodeRequest[] = []
  const places: FakePlace[] = Object.values(PLACES)
  let server: Server | undefined

  type Reply = { status: number; body: unknown }
  const denied: Reply = { status: 403, body: { error: { code: 403, message: "API key not valid", status: "PERMISSION_DENIED" } } }

  const readBody = async (req: IncomingMessage) => {
    let raw = ""
    for await (const chunk of req) raw += chunk
    return raw ? JSON.parse(raw) : {}
  }

  const autocomplete = async (req: IncomingMessage): Promise<Reply> => {
    const body = (await readBody(req)) as AutocompleteRequest
    autocompletes.push(body)
    const words = body.input.toLowerCase().split(/\s+/).filter(Boolean)
    const matches = places.filter((p) => {
      const text = `${p.main} ${p.secondary}`.toLowerCase()
      const country = p.addressComponents.find((c) => c.types.includes("country"))!.shortText.toLowerCase()
      const allowed = !body.includedRegionCodes?.length || body.includedRegionCodes.includes(country)
      return allowed && words.every((w) => text.includes(w))
    })
    return {
      status: 200,
      body: {
        suggestions: matches.map((p) => ({
          placePrediction: {
            place: `places/${p.id}`,
            placeId: p.id,
            text: { text: `${p.main}, ${p.secondary}` },
            structuredFormat: { mainText: { text: p.main }, secondaryText: { text: p.secondary } },
            types: ["street_address"],
          },
        })),
      },
    }
  }

  const describe = (req: IncomingMessage, url: URL): Reply => {
    const placeId = decodeURIComponent(url.pathname.slice("/v1/places/".length))
    const fieldMask = req.headers["x-goog-fieldmask"] as string | undefined
    details.push({ placeId, fieldMask, sessionToken: url.searchParams.get("sessionToken") })
    const place = places.find((p) => p.id === placeId)
    if (!place) return { status: 404, body: { error: { code: 404, message: "Not found", status: "NOT_FOUND" } } }
    // Google answers only the fields asked for.
    const fields = (fieldMask ?? "").split(",")
    return { status: 200, body: Object.fromEntries(fields.map((f) => [f, place[f as keyof FakePlace]])) }
  }

  const reverseGeocode = (url: URL): Reply => {
    const latlng = url.searchParams.get("latlng")
    reverseGeocodes.push({ latlng })
    const [lat, lng] = (latlng ?? "").split(",").map(Number)
    const distance = (p: FakePlace) => Math.hypot(p.location.latitude - lat, p.location.longitude - lng)
    const near = places.filter((p) => distance(p) < 1).sort((a, b) => distance(a) - distance(b))
    return {
      status: 200,
      body: {
        status: near.length ? "OK" : "ZERO_RESULTS",
        results: near.map((p) => ({
          formatted_address: p.formattedAddress,
          address_components: p.addressComponents.map((c) => ({ long_name: c.longText, short_name: c.shortText, types: c.types })),
          geometry: { location: { lat: p.location.latitude, lng: p.location.longitude } },
          types: ["street_address"],
        })),
      },
    }
  }

  const handle = async (req: IncomingMessage): Promise<Reply> => {
    const url = new URL(req.url ?? "/", "https://fake")
    if (req.method === "GET" && url.pathname === "/maps/api/geocode/json") {
      // The Geocoding API refuses a bad key with a 200 and a status of its own.
      if (url.searchParams.get("key") !== apiKey) return { status: 200, body: { status: "REQUEST_DENIED", results: [] } }
      return reverseGeocode(url)
    }
    if (req.headers["x-goog-api-key"] !== apiKey) return denied
    if (req.method === "POST" && url.pathname === "/v1/places:autocomplete") return autocomplete(req)
    if (req.method === "GET" && url.pathname.startsWith("/v1/places/")) return describe(req, url)
    return { status: 404, body: { error: { code: 404, message: "Not found" } } }
  }

  const apiUrl = `http://127.0.0.1:${port}`
  return {
    apiKey,
    placesUrl: `${apiUrl}/v1`,
    geocodingUrl: `${apiUrl}/maps/api/geocode/json`,
    start: () =>
      new Promise<void>((resolve) => {
        server = createServer((req, res) => {
          void handle(req).then(({ status, body }) => {
            res.writeHead(status, { "content-type": "application/json" })
            res.end(JSON.stringify(body))
          })
        })
        server.listen(port, "127.0.0.1", resolve)
      }),
    stop: () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
    /** Every autocomplete request, oldest first. */
    autocompletes: () => [...autocompletes],
    /** Every Place Details request, oldest first. */
    details: () => [...details],
    /** Every reverse geocode request, oldest first. */
    reverseGeocodes: () => [...reverseGeocodes],
    reset: () => {
      autocompletes.length = 0
      details.length = 0
      reverseGeocodes.length = 0
    },
  }
}
