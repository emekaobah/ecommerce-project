import { ClientError } from '@oja/api-client';
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // A 401 has already signed the member out; retrying it only repeats the failure.
      retry: (failures, error) => !(error instanceof ClientError && error.status === 401) && failures < 1,
    },
  },
});
