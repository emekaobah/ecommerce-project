import { createVendorClient } from '@oja/api-client';
import { liveActivityPhone, type PhoneKeyPorts } from '@oja/expo-live-activity';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import { vendorClient } from '@/api/client';
import { env } from '@/config/env';
import type { Session } from '@/session/session-store';

export const phone = liveActivityPhone({ Constants, SecureStore });

/** The phone's key and how it gets one (ADR 0018), on either platform: the keychain and the vendor routes. */
export function memberKeyPorts(endActivities: () => void): PhoneKeyPorts<Session | undefined> {
  const { readKey, saveKey, clearKey, environment, withKey } = phone;
  return {
    readKey,
    saveKey,
    clearKey,
    endActivities,
    register: async (key, pushToken) => {
      const { device } = await vendorClient.vendor.liveActivityDevices.mutate({ environment, ...(pushToken ? { push_token: pushToken } : {}), ...withKey(key) });
      return device.key;
    },
    remove: async (key, session) => {
      if (!session) return;
      // The session is already cleared by now, and this must never sign anyone out itself.
      const client = createVendorClient({ baseUrl: env.apiUrl, getToken: () => session.token, getSellerId: () => session.sellerId });
      await client.vendor.liveActivityDevices.current.delete(withKey(key));
    },
  };
}
