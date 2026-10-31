import { useAuth } from '@clerk/expo';
import { useEffect } from 'react';

import { storeClient } from '@/api/client';
import { openPushConsent } from '@/navigation';

import { devicePushToken, notificationPermission, pushesCanArrive } from './device-push-token';
import { shouldAskPushConsent } from './push-consent';

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

/**
 * Registers straight away where the phone has already allowed or denied notifications; otherwise
 * shows the consent screen first, which registers once the buyer continues (#136).
 */
async function registerOrAskConsent(): Promise<void> {
  let permission;
  try {
    permission = await notificationPermission();
  } catch (error) {
    console.warn('Reading the notification permission failed', error);
    return;
  }
  if (shouldAskPushConsent({ signedIn: true, permission, pushesCanArrive: pushesCanArrive() })) openPushConsent();
  else registered = register();
}

/** Registers this device for the buyer's pushes while they are signed in (#27). */
export function usePushRegistration(): void {
  const { isSignedIn, userId } = useAuth();
  useEffect(() => {
    if (isSignedIn && userId) void registerOrAskConsent();
  }, [isSignedIn, userId]);
}

/** The buyer continued past the consent screen: iOS's prompt, then registration as before (#136). */
export function registerAfterConsent(): void {
  registered = register();
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
