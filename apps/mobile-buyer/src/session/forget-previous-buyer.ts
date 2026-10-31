import type { QueryClient } from '@tanstack/react-query';

/**
 * Drops everything the previous buyer fetched. Resets rather than clears: `clear()` destroys
 * queries a screen mounted in the same commit and silently cancels their fetch, leaving that
 * screen pending with nothing in flight. Resetting keeps observers attached and refetches
 * whatever is on screen. Queries no screen observes are removed first: a reset one is never
 * collected, so its key (a search term, a buyer's id) would stay until the app closes.
 */
export function forgetPreviousBuyer(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => query.getObserversCount() === 0 });
  void queryClient.resetQueries();
}
