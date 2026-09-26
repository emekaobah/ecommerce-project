import type { OjaClient } from '@oja/api-client';
import { skipToken, useQuery } from '@tanstack/react-query';

import { vendorClient } from './client';

export const sellerKeys = {
  all: ['sellers'] as const,
  memberships: () => [...sellerKeys.all, 'memberships'] as const,
};

/** The shops the signed-in member belongs to. Takes a client so sign-in can call it before a session exists. */
export async function fetchMemberships(client: OjaClient) {
  const { seller_members } = await client.vendor.sellers.query();
  return seller_members;
}

/** The shop the member is acting for. Waits while there is no session. */
export function useCurrentSeller(sellerId: string | undefined) {
  return useQuery({
    queryKey: sellerKeys.memberships(),
    queryFn: sellerId ? () => fetchMemberships(vendorClient) : skipToken,
    select: (memberships) => memberships.find((m) => m.seller_id === sellerId)?.seller,
  });
}
