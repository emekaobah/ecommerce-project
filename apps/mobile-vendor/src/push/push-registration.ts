import { createVendorClient } from '@oja/api-client';
import { useEffect } from 'react';

import { vendorClient } from '@/api/client';
import { env } from '@/config/env';
import { getSession, useSession, type Session } from '@/session/session-store';

import { devicePushToken } from './device-push-token';

/** The device as last registered, with the credentials to remove it once the session is gone. */
let registered: { pushToken: string; session: Session } | undefined;

async function register(session: Session) {
  try {
    const pushToken = await devicePushToken();
    if (!pushToken) return;
    await vendorClient.vendor.pushTokens.mutate({ token: pushToken });
    registered = { pushToken, session };
  } catch (error) {
    // Pushes are a convenience: the order list still refreshes on its own.
    console.warn('Registering for push notifications failed', error);
  }
}

/** Registers this device for the shops' pushes while a member is signed in (#27). */
export function usePushRegistration(): void {
  // Again only when the member changes, not when they switch shop: pushes come from all their shops.
  const memberToken = useSession()?.token;
  useEffect(() => {
    const session = getSession();
    if (memberToken && session) void register(session);
  }, [memberToken]);
}

/**
 * At sign-out, stops this device getting the member's pushes. Takes the credentials it was
 * registered with, so it works after the session is cleared, and never signs anyone out itself.
 */
export async function forgetDevice(): Promise<void> {
  const device = registered;
  registered = undefined;
  if (!device) return;
  const client = createVendorClient({
    baseUrl: env.apiUrl,
    getToken: () => device.session.token,
    getSellerId: () => device.session.sellerId,
  });
  try {
    await client.vendor.pushTokens.$token.delete({ $token: encodeURIComponent(device.pushToken) });
  } catch (error) {
    // An expired session can't remove it; the next member to sign in on the device takes it over.
    console.warn('Removing the device from push notifications failed', error);
  }
}
