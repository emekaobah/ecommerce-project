import { useAuth } from '@clerk/expo';
import { rememberSearch } from '@oja/domain';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';

// Recent searches live on the phone only, kept as cart ids are: one list for the guest and one per
// buyer who has signed in here, so the next person to sign in never sees someone else's.

/** Whose searches: a Clerk user id, or null for the guest. */
type SearchOwner = string | null;

function keyFor(owner: SearchOwner) {
  return `oja.recent-searches.${owner ?? 'guest'}`;
}

async function readSearches(owner: SearchOwner): Promise<string[]> {
  try {
    const stored = await SecureStore.getItemAsync(keyFor(owner));
    const searches: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(searches) ? searches.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    // An unreadable keychain, or a value from another build, is no history.
    return [];
  }
}

async function keepSearches(owner: SearchOwner, searches: string[]): Promise<void> {
  try {
    if (searches.length) await SecureStore.setItemAsync(keyFor(owner), JSON.stringify(searches));
    else await SecureStore.deleteItemAsync(keyFor(owner));
  } catch {
    // An unwritable keychain keeps them for this session only.
  }
}

/** The searches with the owner they were read for, so one buyer's never show for another. */
type OwnedSearches = { owner: SearchOwner; searches: string[] };

const NONE: string[] = [];

/**
 * The buyer's recent searches on this phone, newest first. `remember` adds one the buyer used
 * (submitted, or opened a product from its results); `clear` removes them all.
 */
export function useRecentSearches() {
  const { isLoaded, userId } = useAuth();
  const owner: SearchOwner = userId ?? null;
  const [read, setRead] = useState<OwnedSearches | null>(null);
  const searches = read?.owner === owner ? read.searches : NONE;

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    void readSearches(owner).then((stored) => {
      // A search used while the list was being read is newer than what was read.
      if (!cancelled) setRead((shown) => (shown?.owner === owner ? shown : { owner, searches: stored }));
    });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, owner]);

  const update = useCallback(
    (updated: string[]) => {
      setRead({ owner, searches: updated });
      void keepSearches(owner, updated);
    },
    [owner]
  );

  const remember = useCallback((search: string) => update(rememberSearch(searches, search)), [searches, update]);
  const clear = useCallback(() => update([]), [update]);

  return { searches, remember, clear };
}
