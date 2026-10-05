import { useAuth } from '@clerk/expo';
import { useEffect } from 'react';

import { storeClient } from '@/api/client';

import { devicePushToken } from './device-push-token';

/** The device's push token as last registered for the signed-in buyer. */
let registered: string | undefined;

async function register() {
  try {
    const pushToken = await devicePushToken();
    if (!pushToken) return;
    await storeClient.store.pushTokens.mutate({ token: pushToken });
    registered = pushToken;
  } catch (error) {
    console.warn('Registering for push notifications failed', error);
  }
}

/** Registers this device for the buyer's pushes while they are signed in (#27). */
export function usePushRegistration(): void {
  const { isSignedIn, userId } = useAuth();
  useEffect(() => {
    if (isSignedIn && userId) void register();
  }, [isSignedIn, userId]);
}

/** Before sign-out, while the session still works: stops this device getting the buyer's pushes. */
export async function forgetDevice(): Promise<void> {
  const pushToken = registered;
  registered = undefined;
  if (!pushToken) return;
  try {
    await storeClient.store.pushTokens.$token.delete({ $token: encodeURIComponent(pushToken) });
  } catch (error) {
    // The next buyer to sign in on the device takes it over.
    console.warn('Removing the device from push notifications failed', error);
  }
}
