import { createVendorClient } from '@oja/api-client';
import { pushPlatform } from '@oja/expo-push';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { vendorClient } from '@/api/client';
import { env } from '@/config/env';
import { liveActivityTokens } from '@/live-activity/register';
import { useSession, type Session } from '@/session/session-store';

import { devicePushToken } from './device-push-token';

/** The device's push token once registered for the signed-in member; pending while registering. */
let registered: Promise<string | null> = Promise.resolve(null);

async function register(): Promise<string | null> {
  try {
    const pushToken = await devicePushToken();
    if (!pushToken) return null;
    await vendorClient.vendor.pushTokens.mutate({ token: pushToken, platform: pushPlatform(Platform.OS) });
    liveActivityTokens.pushTokenRegistered(pushToken);
    return pushToken;
  } catch (error) {
    // Pushes are a convenience: the order list still refreshes on its own.
    console.warn('Registering for push notifications failed', error);
    return null;
  }
}

/** Registers this device for the shops' pushes while a member is signed in (#27). */
export function usePushRegistration(): void {
  // Again only when the member changes, not when they switch shop: pushes come from all their shops.
  const memberToken = useSession()?.token;
  useEffect(() => {
    if (!memberToken) return;
    registered = register();
    // Whether or not pushes are allowed: Live Activities are a separate permission.
    liveActivityTokens.signedIn();
  }, [memberToken]);
}

/**
 * At sign-out, stops this device getting the member's pushes. Takes the session as it was just
 * before sign-out, so it works once the session is cleared, and never signs anyone out itself.
 * Waits for a registration still under way, so it can't land after the removal.
 */
export async function forgetDevice(session: Session | undefined): Promise<void> {
  void liveActivityTokens.signingOut(session);
  const pending = registered;
  registered = Promise.resolve(null);
  const pushToken = await pending;
  if (!pushToken || !session) return;
  const client = createVendorClient({
    baseUrl: env.apiUrl,
    getToken: () => session.token,
    getSellerId: () => session.sellerId,
  });
  try {
    await client.vendor.pushTokens.$token.delete({ $token: encodeURIComponent(pushToken) });
  } catch (error) {
    // An expired session can't remove it; the next member to sign in on the device takes it over.
    console.warn('Removing the device from push notifications failed', error);
  }
}
