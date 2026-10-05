import type { Pin } from '@oja/domain';
import { randomUUID } from 'expo-crypto';
import { keepPreviousData, skipToken, useMutation, useQuery } from '@tanstack/react-query';

import { storeClient } from './client';

// Address search, a place's address and the address at the buyer's location (ADR 0002), looked
// up by the backend with its Google key (`LookupFor` says which countries).

/**
 * What a lookup is for: the cart being checked out, or, adding a saved address with no cart
 * (#18), the region the app shops in. Either one's region decides the countries searched.
 */
export type LookupFor = { cart_id: string } | { region_id: string };

export const addressLookupKeys = {
  all: ['address-lookup'] as const,
  suggestions: (lookup: LookupFor, sessionToken: string, input: string) =>
    [...addressLookupKeys.all, 'suggestions', { ...lookup, sessionToken, input }] as const,
};

/**
 * A new lookup session: Google bills a search and the place chosen from it as one session, so
 * the screen makes one when the buyer starts searching and a new one after they choose.
 */
export function newLookupSession(): string {
  return randomUUID();
}

async function fetchSuggestions(lookup: LookupFor, sessionToken: string, input: string) {
  const { suggestions } = await storeClient.store.addressLookup.suggestions.query({
    ...lookup,
    session_token: sessionToken,
    input,
  });
  return suggestions;
}

export type AddressSuggestion = Awaited<ReturnType<typeof fetchSuggestions>>[number];

/** How much the buyer types before suggestions are looked up. */
export const MIN_SEARCH_LENGTH = 3;

/** Places matching what the buyer typed (already debounced), from `MIN_SEARCH_LENGTH` characters on. */
export function useAddressSuggestions(lookup: LookupFor, sessionToken: string, input: string) {
  const text = input.trim();
  return useQuery({
    queryKey: addressLookupKeys.suggestions(lookup, sessionToken, text),
    queryFn: text.length >= MIN_SEARCH_LENGTH ? () => fetchSuggestions(lookup, sessionToken, text) : skipToken,
    // The last list stays up while the next one loads, so it doesn't flicker as they type.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

/** A suggested place's address, which ends its lookup session. */
export function usePlaceAddress(lookup: LookupFor) {
  return useMutation({
    mutationFn: async ({ placeId, sessionToken }: { placeId: string; sessionToken: string }) => {
      const { place } = await storeClient.store.addressLookup.places.$placeId.query({
        $placeId: placeId,
        ...lookup,
        session_token: sessionToken,
      });
      return place;
    },
  });
}

/** The address at a point, or null where the store doesn't deliver or Google knows none. */
export function useAddressAt(lookup: LookupFor) {
  return useMutation({
    mutationFn: async ({ latitude, longitude }: Pin) => {
      const { place } = await storeClient.store.addressLookup.reverseGeocode.query({
        ...lookup,
        latitude,
        longitude,
      });
      return place;
    },
  });
}
