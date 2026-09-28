import { useState } from 'react';

/**
 * Pull-to-refresh state for a list: only a pull shows the spinner, so background
 * refetches stay silent. `refresh` also serves as a retry after an error.
 */
export function usePullToRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void refetch().finally(() => setRefreshing(false));
  };
  return { refreshing, refresh };
}
