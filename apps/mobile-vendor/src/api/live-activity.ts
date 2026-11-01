import { LIVE_ACTIVITY_KEY_HEADER } from '@oja/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { liveActivityTokens } from '@/live-activity/register';

import { vendorClient } from './client';

const lockScreenKey = (sellerId: string) => ['live-activity', 'shop', sellerId] as const;

const withKey = (key: string | null) => ({ fetchOptions: { headers: (key ? { [LIVE_ACTIVITY_KEY_HEADER]: key } : {}) as Record<string, string> } });

/** Whether this phone has "Orders on Lock Screen" on for the shop the member is acting for. */
export function useOrdersOnLockScreen(sellerId: string) {
  return useQuery({
    queryKey: lockScreenKey(sellerId),
    enabled: liveActivityTokens.available,
    queryFn: async () => {
      const key = await liveActivityTokens.currentKey();
      return key ? (await vendorClient.vendor.liveActivityDevices.current.shop.query(withKey(key))).on : false;
    },
  });
}

/** Saves the switch on the server, which is how it knows to start the activity on this phone. */
export function useSetOrdersOnLockScreen(sellerId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (on: boolean) => {
      const key = await liveActivityTokens.ensureKey();
      return (await vendorClient.vendor.liveActivityDevices.current.shop.mutate({ on, ...withKey(key) })).on;
    },
    onSuccess: (on) => client.setQueryData(lockScreenKey(sellerId), on),
  });
}
