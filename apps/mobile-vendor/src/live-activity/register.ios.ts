import { apnsEnvironment, LIVE_ACTIVITY_KEY_HEADER } from '@oja/domain';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { addPushToStartTokenListener, type LiveActivity } from 'expo-widgets';
import { AppState, Platform } from 'react-native';
import { createVendorClient } from '@oja/api-client';

import { vendorClient } from '@/api/client';
import { env } from '@/config/env';
import type { Session } from '@/session/session-store';

import { shopActivity, type ShopActivityContent } from './shop-activity';
import { tokenReporter, type TokenReport } from './token-reporter';

// Imported by the root layout, so it runs at JS startup, on a background launch too: that launch
// only runs the root layout's imports, and iOS hands the tokens over then (#140).

const KEY_ITEM = 'oja.live-activity-key';
// A background launch can run on a locked phone, which a default keychain item won't open for.
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
/** A push-started activity can appear while the JS is running, and iOS says nothing to it. */
const SCAN_EVERY_MS = 2000;
/** The server starts this app's activities by push, which iOS only allows from here. */
const FIRST_PUSH_TO_START_IOS = 17.2;

const environment = ((Constants.expoConfig?.extra as { apnsEnvironment?: 'sandbox' | 'production' } | undefined)?.apnsEnvironment ??
  apnsEnvironment(undefined).host) as 'sandbox' | 'production';

const withKey = (key: string | null) => ({ fetchOptions: { headers: (key ? { [LIVE_ACTIVITY_KEY_HEADER]: key } : {}) as Record<string, string> } });

const reporter = tokenReporter<Session>({
  readKey: () => SecureStore.getItemAsync(KEY_ITEM, KEYCHAIN),
  saveKey: (key) => SecureStore.setItemAsync(KEY_ITEM, key, KEYCHAIN),
  clearKey: () => SecureStore.deleteItemAsync(KEY_ITEM, KEYCHAIN),
  register: async (key) => {
    const { device } = await vendorClient.vendor.liveActivityDevices.mutate({ environment, ...withKey(key) });
    return device.key;
  },
  remove: async (key, session) => {
    // The session is already cleared by now, and this must never sign anyone out itself.
    const client = createVendorClient({ baseUrl: env.apiUrl, getToken: () => session.token, getSellerId: () => session.sellerId });
    await client.vendor.liveActivityDevices.current.delete(withKey(key));
  },
  // Only the phone's key. Not through `vendorClient`, whose 401 would sign the member out.
  post: async (key, report: TokenReport) => {
    const { status } = await fetch(`${env.apiUrl}/vendor/live-activity-tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [LIVE_ACTIVITY_KEY_HEADER]: key },
      body: JSON.stringify({ ...report, environment }),
    });
    if (status === 401) return 'revoked';
    return status >= 200 && status < 300 ? 'ok' : 'failed';
  },
});

// Held for the life of the JS: the library cancels an activity's token observer when its object is released (#140).
const watched = new Map<string, LiveActivity<ShopActivityContent>>();
/** Activities whose token has arrived this launch: until then, each scan asks again. */
const tokenSeen = new Set<string>();

function watch(activity: LiveActivity<ShopActivityContent>) {
  const id = activity.getId();
  if (watched.has(id)) return;
  watched.set(id, activity);
  activity.addPushTokenListener(({ activityId, pushToken }) => {
    tokenSeen.add(activityId);
    reporter.activityToken(activityId, pushToken);
  });
}

async function askForToken(activity: LiveActivity<ShopActivityContent>) {
  // Null until the member answers iOS's Allow prompt, which can take minutes or never come (#140).
  const token = await activity.getPushToken().catch(() => null);
  if (!token || tokenSeen.has(activity.getId())) return;
  tokenSeen.add(activity.getId());
  reporter.activityToken(activity.getId(), token);
}

function scan() {
  const running = shopActivity.getInstances();
  for (const activity of running) {
    watch(activity);
    if (!tokenSeen.has(activity.getId())) void askForToken(activity);
  }
  const ids = new Set(running.map((activity) => activity.getId()));
  for (const id of watched.keys()) if (!ids.has(id)) watched.delete(id);
}

// iOS issues the push-to-start token only once a listener is added, so the app must have been opened once.
addPushToStartTokenListener(({ activityPushToStartToken }) => reporter.pushToStartToken(activityPushToStartToken));
scan();
setInterval(scan, SCAN_EVERY_MS);
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    scan();
    reporter.retry();
  }
});

export const liveActivityTokens = {
  ...reporter,
  /** Whether this phone can run the shop's activity, so the switch shows. */
  available: Number.parseFloat(String(Platform.Version)) >= FIRST_PUSH_TO_START_IOS,
};
