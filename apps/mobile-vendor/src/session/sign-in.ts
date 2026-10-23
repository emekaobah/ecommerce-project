import { createVendorClient, loginMember } from '@oja/api-client';
import { shopChoice } from '@oja/domain';

import { fetchMemberships } from '@/api/sellers';
import { env } from '@/config/env';

import { saveSession, saveTokenForShopChoice } from './session-store';

/** Signing in to an account that belongs to no shop. */
export class NoShopError extends Error {
  constructor() {
    super('This account is not a member of any shop. Ask your shop owner to invite you.');
    this.name = 'NoShopError';
  }
}

/**
 * Exchanges credentials for a member JWT and persists it. A member of one shop
 * goes straight in; a member of several picks a shop next.
 */
export async function signIn(email: string, password: string): Promise<void> {
  const token = await loginMember(env.apiUrl, { email, password });
  // Nothing is stored until the member's shops are known, so a failed sign-in leaves no half session.
  const memberships = await fetchMemberships(createVendorClient({ baseUrl: env.apiUrl, getToken: () => token }));
  const choice = shopChoice(memberships);
  if (choice.kind === 'none') throw new NoShopError();
  if (choice.kind === 'only') await saveSession({ token, sellerId: choice.sellerId });
  else await saveTokenForShopChoice(token);
}
