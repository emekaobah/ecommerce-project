import { useAuth } from '@clerk/expo';
import { useEffect } from 'react';

import { storeClient } from '@/api/client';

import { devicePushToken } from './device-push-token';

/** The device's push token once registered for the signed-in buyer; pending while registering. */
let registered: Promise<string | null> = Promise.resolve(null);

async function register(): Promise<string | null> {
  try {
    const pushToken = await devicePushToken();
    if (!pushToken) return null;
    await storeClient.store.pushTokens.mutate({ token: pushToken });
    return pushToken;
  } catch (error) {
    console.warn('Registering for push notifications failed', error);
    return null;
  }
}

/** Registers this device for the buyer's pushes while they are signed in (#27). */
export function usePushRegistration(): void {
  const { isSignedIn, userId } = useAuth();
  useEffect(() => {
    if (isSignedIn && userId) registered = register();
  }, [isSignedIn, userId]);
}

/**
 * Before sign-out, while the session still works: stops this device getting the buyer's pushes.
 * Waits for a registration still under way, so it can't land after the removal.
 */
export async function forgetDevice(): Promise<void> {
  const pending = registered;
  registered = Promise.resolve(null);
  const pushToken = await pending;
  if (!pushToken) return;
  try {
    await storeClient.store.pushTokens.$token.delete({ $token: encodeURIComponent(pushToken) });
  } catch (error) {
    // The next buyer to sign in on the device takes it over.
    console.warn('Removing the device from push notifications failed', error);
  }
}
