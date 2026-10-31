import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { forgetPreviousBuyer } from './forget-previous-buyer';

/**
 * Resets every cached query when the signed-in buyer changes: sign-out, a different buyer
 * signing in, or the session ending in Clerk. Nothing one buyer fetched outlives their session,
 * and screens already mounted for the new buyer refetch instead of being left on skeletons.
 */
export function useClearCacheOnUserChange() {
  const { isLoaded, userId } = useAuth();
  const queryClient = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    if (previous.current !== undefined && previous.current !== userId) forgetPreviousBuyer(queryClient);
    previous.current = userId ?? null;
  }, [isLoaded, userId, queryClient]);
}
