import { useAuth } from '@clerk/expo';
import { applySearchChanges, type SearchChange } from '@oja/domain';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useReducer } from 'react';

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

/** Whose searches, once Clerk has said who is signed in: undefined until then. */
type MaybeOwner = SearchOwner | undefined;

/** A change made before its owner's list was read: it joins that list once it is. */
type Pending = { owner: MaybeOwner; change: SearchChange };

type Recent = {
  /** The list as read from the phone, with the owner it was read for; null until one is. */
  list: { owner: SearchOwner; searches: string[] } | null;
  pending: Pending[];
  /** The list changed since it was read, so it's kept. */
  changed: boolean;
};

type RecentAction = { type: 'read'; owner: SearchOwner; stored: string[] } | { type: 'change'; owner: MaybeOwner; change: SearchChange };

/** A change made before Clerk loaded is the signed-in buyer's, whoever that turns out to be. */
const isFor = (owner: SearchOwner) => (pending: Pending) => pending.owner === undefined || pending.owner === owner;

/** How the recent searches change as the phone's list is read and the buyer uses them: exported for its tests. */
export function recentReducer(state: Recent, action: RecentAction): Recent {
  if (action.type === 'read') {
    // Changes for another owner (the buyer switched while their list was read) aren't shown to this one.
    const changes = state.pending.filter(isFor(action.owner)).map((pending) => pending.change);
    return { list: { owner: action.owner, searches: applySearchChanges(action.stored, changes) }, pending: [], changed: changes.length > 0 };
  }
  const { list } = state;
  if (action.owner !== undefined && list?.owner === action.owner) {
    return { list: { owner: list.owner, searches: applySearchChanges(list.searches, [action.change]) }, pending: [], changed: true };
  }
  return { ...state, pending: [...state.pending, { owner: action.owner, change: action.change }], changed: false };
}

/**
 * The buyer's recent searches on this phone, newest first. `remember` adds one the buyer used
 * (submitted, or opened a product from its results); `clear` removes them all. Nothing is kept
 * until Clerk has said whose they are and that buyer's list has been read: what's used before
 * then joins it rather than replacing it.
 */
export function useRecentSearches() {
  const { isLoaded, userId } = useAuth();
  const owner: MaybeOwner = isLoaded ? (userId ?? null) : undefined;
  const [recent, dispatch] = useReducer(recentReducer, { list: null, pending: [], changed: false });
  const { list, pending, changed } = recent;
  const searches = useMemo(
    () =>
      owner !== undefined && list?.owner === owner
        ? list.searches
        : // While the list is read, the searches used meanwhile.
          applySearchChanges([], (owner === undefined ? pending : pending.filter(isFor(owner))).map((p) => p.change)),
    [owner, list, pending]
  );

  useEffect(() => {
    if (owner === undefined) return;
    let cancelled = false;
    void readSearches(owner).then((stored) => {
      if (!cancelled) dispatch({ type: 'read', owner, stored });
    });
    return () => {
      cancelled = true;
    };
  }, [owner]);

  useEffect(() => {
    if (changed && list) void keepSearches(list.owner, list.searches);
  }, [changed, list]);

  const remember = useCallback((search: string) => dispatch({ type: 'change', owner, change: { type: 'used', search } }), [owner]);
  const clear = useCallback(() => dispatch({ type: 'change', owner, change: { type: 'cleared' } }), [owner]);

  return { searches, remember, clear };
}
