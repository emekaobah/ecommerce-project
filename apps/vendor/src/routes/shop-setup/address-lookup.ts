import type { Pin } from "@oja/domain"
import { keepPreviousData, skipToken, useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { client } from "../../lib/client"

// Pickup address search, a place's address and the address at the owner's location (ADR 0002,
// #41), looked up by the backend with its Google key in the countries the shop trades in.

/**
 * A new lookup session: Google bills a search and the place chosen from it as one session, so
 * the form makes one when the owner starts searching and a new one after they choose.
 */
export const newLookupSession = () => crypto.randomUUID()

// Mercur's client types a GET's input from the route's body, not its query (offer-cost.tsx
// works around it the same way), so the query goes in as fetch input, which the route validates.
type NoInput = { fetchOptions?: RequestInit }

/** How much the owner types before suggestions are looked up. */
export const MIN_SEARCH_LENGTH = 3

/** The value once it has stopped changing for `delay` ms. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}

/** Places matching what the owner typed (already debounced), from `MIN_SEARCH_LENGTH` characters on. */
export function useAddressSuggestions(sessionToken: string, input: string) {
  const text = input.trim()
  return useQuery({
    queryKey: ["pickup-address-lookup", "suggestions", { sessionToken, text }],
    queryFn:
      text.length >= MIN_SEARCH_LENGTH
        ? async () =>
            (await client.vendor.addressLookup.suggestions.query({ session_token: sessionToken, input: text } as NoInput))
              .suggestions
        : skipToken,
    // The last list stays up while the next one loads, so it doesn't flicker as they type.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}

/** A suggested place's address, which ends its lookup session. */
export const usePlaceAddress = () =>
  useMutation({
    mutationFn: async ({ placeId, sessionToken }: { placeId: string; sessionToken: string }) =>
      (
        await client.vendor.addressLookup.places.$placeId.query({ $placeId: placeId, session_token: sessionToken } as NoInput & {
          $placeId: string
        })
      ).place,
  })

/** The address at a point, or null where the shop doesn't trade or Google knows none. */
export const useAddressAt = () =>
  useMutation({
    mutationFn: async ({ latitude, longitude }: Pin) =>
      (await client.vendor.addressLookup.reverseGeocode.query({ latitude, longitude } as NoInput)).place,
  })

/** Where the owner is, once the browser allows it; null when location is off or unavailable. */
export const currentPosition = () =>
  new Promise<Pin | null>((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000 }
    )
  })
