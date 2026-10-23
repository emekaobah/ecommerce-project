import { useToast } from '@oja/ui';
import { useState } from 'react';

/**
 * Pull to refresh that keeps the list on screen (State rules): only a pull shows the spinner, and
 * a refresh that fails while something is already shown says so in a toast, not an error screen.
 */
export function useListRefresh(refetch: () => Promise<{ error: unknown; data: unknown }>) {
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void refetch()
      .then((result) => {
        if (result.error && result.data) toast({ message: "Couldn't refresh. Check your connection.", tone: 'problem' });
      })
      .finally(() => setRefreshing(false));
  };
  return { refreshing, refresh };
}
