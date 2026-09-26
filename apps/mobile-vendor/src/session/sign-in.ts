import { createVendorClient, loginMember } from '@oja/api-client';

import { fetchMemberships } from '@/api/sellers';
import { env } from '@/config/env';

import { saveSession } from './session-store';

/** Exchanges credentials for a member JWT, picks the member's shop and persists both. */
export async function signIn(email: string, password: string): Promise<void> {
  const token = await loginMember(env.apiUrl, { email, password });
  // Nothing is stored until the member's shop is known, so a failed sign-in leaves no half session.
  const memberships = await fetchMemberships(createVendorClient({ baseUrl: env.apiUrl, getToken: () => token }));
  // A member can belong to several shops; the shop picker replaces this first-shop choice.
  const membership = memberships[0];
  if (!membership) throw new Error('This account is not a member of any shop.');
  await saveSession({ token, sellerId: membership.seller_id });
}
