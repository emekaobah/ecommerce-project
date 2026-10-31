import type { QueryClient } from '@tanstack/react-query';

/**
 * Drops everything the previous buyer fetched. Resets rather than clears: `clear()` destroys
 * queries a screen mounted in the same commit and silently cancels their fetch, leaving that
 * screen pending with nothing in flight. Resetting keeps observers attached and refetches
 * whatever is on screen.
 */
export function forgetPreviousBuyer(queryClient: QueryClient) {
  void queryClient.resetQueries();
}
