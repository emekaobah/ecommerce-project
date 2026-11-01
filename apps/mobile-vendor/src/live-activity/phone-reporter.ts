import { createVendorClient } from '@oja/api-client';
import { apnsEnvironment, LIVE_ACTIVITY_KEY_HEADER } from '@oja/domain';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import { vendorClient } from '@/api/client';
import { env } from '@/config/env';
import type { Session } from '@/session/session-store';

import { tokenReporter, type PostResult, type TokenReport } from './token-reporter';

const KEY_ITEM = 'oja.live-activity-key';
// A background launch can run on a locked phone, which a default keychain item won't open for.
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

type Environment = 'sandbox' | 'production';

const environment = ((Constants.expoConfig?.extra as { apnsEnvironment?: Environment } | undefined)?.apnsEnvironment ?? apnsEnvironment(undefined).host) as Environment;

const withKey = (key: string | null) => ({ fetchOptions: { headers: (key ? { [LIVE_ACTIVITY_KEY_HEADER]: key } : {}) as Record<string, string> } });

/** The phone's key and how it gets one (ADR 0018), on either platform: `tokenReporter` wired to the keychain and the vendor routes. */
export function phoneReporter({
  post,
  pushToken = () => undefined,
}: {
  post: (key: string, report: TokenReport, environment: Environment) => Promise<PostResult>;
  /** What the server pushes this phone through, if not Apple. */
  pushToken?: () => string | undefined;
}) {
  return tokenReporter<Session>({
    readKey: () => SecureStore.getItemAsync(KEY_ITEM, KEYCHAIN),
    saveKey: (key) => SecureStore.setItemAsync(KEY_ITEM, key, KEYCHAIN),
    clearKey: () => SecureStore.deleteItemAsync(KEY_ITEM, KEYCHAIN),
    register: async (key) => {
      const push_token = pushToken();
      const { device } = await vendorClient.vendor.liveActivityDevices.mutate({ environment, ...(push_token ? { push_token } : {}), ...withKey(key) });
      return device.key;
    },
    remove: async (key, session) => {
      // The session is already cleared by now, and this must never sign anyone out itself.
      const client = createVendorClient({ baseUrl: env.apiUrl, getToken: () => session.token, getSellerId: () => session.sellerId });
      await client.vendor.liveActivityDevices.current.delete(withKey(key));
    },
    post: (key, report) => post(key, report, environment),
  });
}
