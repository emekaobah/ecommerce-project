import { useAuth } from '@clerk/expo';
import { useEffect } from 'react';

import { storeClient } from '@/api/client';
import { openPushConsent } from '@/navigation';

import { devicePushToken, notificationPermission, pushesCanArrive } from './device-push-token';
import { deviceRegistration } from './device-registration';

const registration = deviceRegistration({
  permission: notificationPermission,
  pushesCanArrive,
  pushToken: devicePushToken,
  add: async (token) => {
    await storeClient.store.pushTokens.mutate({ token });
  },
  remove: async (token) => {
    await storeClient.store.pushTokens.$token.delete({ $token: encodeURIComponent(token) });
  },
  askConsent: openPushConsent,
});

/** Registers this device for the buyer's pushes while they are signed in (#27). */
export function usePushRegistration(): void {
  const { isSignedIn, userId } = useAuth();
  useEffect(() => {
    if (isSignedIn && userId) registration.registerOrAskConsent();
  }, [isSignedIn, userId]);
}

/** The buyer continued past the consent screen: iOS's prompt, then registration as before (#136). */
export const registerAfterConsent = registration.registerAfterConsent;

/**
 * Before sign-out, while the session still works: stops this device getting the buyer's pushes.
 * Waits for a registration still under way, so it can't land after the removal.
 */
export const forgetDevice = registration.forgetDevice;
