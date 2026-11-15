import { apnsEnvironment, LIVE_ACTIVITY_KEY_HEADER } from '@oja/domain';
import type * as ExpoConstants from 'expo-constants';
import type * as ExpoSecureStore from 'expo-secure-store';

import type { PostResult } from './token-reporter';

/** Passed in by each app, so the app's own copy of each native module is the one used (ADR 0012). */
export type PhoneModules = {
  Constants: typeof ExpoConstants.default;
  SecureStore: typeof ExpoSecureStore;
};

type Environment = 'sandbox' | 'production';

const KEY_ITEM = 'oja.live-activity-key';

/** Where a phone keeps its key, which of Apple's hosts its build uses, and how it posts with the key alone. */
export function liveActivityPhone({ Constants, SecureStore }: PhoneModules) {
  // A background launch can run on a locked phone, which a default keychain item won't open for.
  const keychain = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
  const environment = ((Constants.expoConfig?.extra as { apnsEnvironment?: Environment } | undefined)?.apnsEnvironment ?? apnsEnvironment(undefined).host) as Environment;

  return {
    environment,
    readKey: () => SecureStore.getItemAsync(KEY_ITEM, keychain),
    saveKey: (key: string) => SecureStore.setItemAsync(KEY_ITEM, key, keychain),
    clearKey: () => SecureStore.deleteItemAsync(KEY_ITEM, keychain),
    /** For an API client's call that needs the phone's key as well as a session. */
    withKey: (key: string | null) => ({ fetchOptions: { headers: (key ? { [LIVE_ACTIVITY_KEY_HEADER]: key } : {}) as Record<string, string> } }),
    /** Posts with only the phone's key. Not through an API client, whose 401 would sign the person out. */
    postWithKey: (url: string, key: string, body: object, headers: Record<string, string> = {}) =>
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers, [LIVE_ACTIVITY_KEY_HEADER]: key }, body: JSON.stringify(body) }),
    resultOf: ({ status }: { status: number }): PostResult => {
      if (status === 401) return 'revoked';
      return status >= 200 && status < 300 ? 'ok' : 'failed';
    },
  };
}
