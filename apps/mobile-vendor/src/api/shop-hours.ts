import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { vendorClient } from './client';

export const shopHoursKeys = {
  all: ['shop-hours'] as const,
  detail: (sellerId: string) => [...shopHoursKeys.all, sellerId] as const,
  member: (sellerId: string) => [...shopHoursKeys.all, 'member', sellerId] as const,
};

const fetchShopHours = async () => (await vendorClient.vendor.shopHours.query()).shop_hours;

/** The shop's hours, its pause, what buyers see now and how many orders wait to be accepted (ADR 0004). */
export type ShopHours = Awaited<ReturnType<typeof fetchShopHours>>;

export function useShopHours(sellerId: string | undefined) {
  return useQuery({
    queryKey: shopHoursKeys.detail(sellerId ?? ''),
    queryFn: sellerId ? fetchShopHours : skipToken,
  });
}

/** The role that may change the shop: owners and managers (ADR 0004). */
const SELLER_ADMINISTRATION = 'role_seller_administration';

/**
 * Whether the signed-in member may pause and resume orders. The API decides (fulfilment staff
 * are refused); this only hides controls they couldn't use.
 */
export function useMayChangeShop(sellerId: string | undefined) {
  return useQuery({
    queryKey: shopHoursKeys.member(sellerId ?? ''),
    queryFn: sellerId ? () => vendorClient.vendor.members.me.query() : skipToken,
    select: ({ seller_member }) => {
      const member = seller_member as { is_owner?: boolean; rbac_role?: { id?: string } | null };
      return !!member.is_owner || member.rbac_role?.id === SELLER_ADMINISTRATION;
    },
  });
}

/** Stops taking orders now, until resumed or `until` (ISO 8601), with a note for buyers. */
export function usePauseShop(sellerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { until: string | null; note: string | null }) =>
      (await vendorClient.vendor.shopHours.pause.mutate(input)).shop_hours,
    onSuccess: (hours) => queryClient.setQueryData(shopHoursKeys.detail(sellerId), hours),
  });
}

/** Takes orders again now. */
export function useResumeShop(sellerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await vendorClient.vendor.shopHours.resume.mutate({})).shop_hours,
    onSuccess: (hours) => queryClient.setQueryData(shopHoursKeys.detail(sellerId), hours),
  });
}
