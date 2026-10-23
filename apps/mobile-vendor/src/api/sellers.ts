import type { OjaClient } from '@oja/api-client';
import { skipToken, useQuery } from '@tanstack/react-query';

import { vendorClient } from './client';

export const sellerKeys = {
  all: ['sellers'] as const,
  memberships: () => [...sellerKeys.all, 'memberships'] as const,
  member: (sellerId: string) => [...sellerKeys.all, 'member', sellerId] as const,
};

/** The signed-in member of the current shop: their role, and who they are. */
const fetchMember = () => vendorClient.vendor.members.me.query();

/** The role that manages the shop alongside its owner: managers (ADR 0004). */
const SELLER_ADMINISTRATION = 'role_seller_administration';

/**
 * Whether the signed-in member manages the shop (an owner or manager): pausing and resuming
 * orders (ADR 0004) and cancelling an accepted one (#17). The API decides (fulfilment staff are
 * refused); this only hides controls they couldn't use.
 */
export function useMayManageShop(sellerId: string | undefined) {
  return useQuery({
    queryKey: sellerKeys.member(sellerId ?? ''),
    queryFn: sellerId ? fetchMember : skipToken,
    select: ({ seller_member }) => {
      const member = seller_member as { is_owner?: boolean; rbac_role?: { id?: string } | null };
      return !!member.is_owner || member.rbac_role?.id === SELLER_ADMINISTRATION;
    },
  });
}

/** The signed-in member's email, which Settings shows under Sign out. */
export function useMemberEmail(sellerId: string | undefined) {
  return useQuery({
    queryKey: sellerKeys.member(sellerId ?? ''),
    queryFn: sellerId ? fetchMember : skipToken,
    select: ({ seller_member }) => (seller_member as { member?: { email?: string } | null }).member?.email ?? null,
  });
}

/** The shops the signed-in member belongs to. Takes a client so sign-in can call it before a session exists. */
export async function fetchMemberships(client: OjaClient) {
  const { seller_members } = await client.vendor.sellers.query();
  return seller_members;
}

/** Every shop the member belongs to, for the shop picker and settings. */
export function useMemberships() {
  return useQuery({ queryKey: sellerKeys.memberships(), queryFn: () => fetchMemberships(vendorClient) });
}

/** The shop the member is acting for. Waits while there is no session. */
export function useCurrentSeller(sellerId: string | undefined) {
  return useQuery({
    queryKey: sellerKeys.memberships(),
    queryFn: sellerId ? () => fetchMemberships(vendorClient) : skipToken,
    select: (memberships) => memberships.find((m) => m.seller_id === sellerId)?.seller,
  });
}
