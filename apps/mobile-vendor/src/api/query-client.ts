import { ClientError } from '@oja/api-client';
import { QueryCache, QueryClient } from '@tanstack/react-query';

/** Mercur's refusal (400) when the member no longer belongs to the shop in `x-seller-id`. */
const isRemovedFromShop = (error: unknown) =>
  error instanceof ClientError &&
  error.status === 400 &&
  error.message === 'You are not a member of this seller account';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // Refetch the member's shops (sellerKeys.all, not imported: the sellers module needs this client),
    // so useKeepCurrentShop moves them on.
    onError: (error) => {
      if (isRemovedFromShop(error)) void queryClient.invalidateQueries({ queryKey: ['sellers'] });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // A 401 has already signed the member out, and a removed member won't be let back in by a retry.
      retry: (failures, error) =>
        !(error instanceof ClientError && error.status === 401) && !isRemovedFromShop(error) && failures < 1,
    },
  },
});
