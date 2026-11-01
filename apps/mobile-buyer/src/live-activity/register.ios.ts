import { apnsEnvironment, buyerActivityOrderId, LIVE_ACTIVITY_KEY_HEADER, type BuyerActivityContent } from '@oja/domain';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { addPushToStartTokenListener, type LiveActivity } from 'expo-widgets';
import { AppState, Platform } from 'react-native';

import { storeClient } from '@/api/client';
import { env } from '@/config/env';

import { orderActivity } from './order-activity';
import { tokenReporter, type OwedActivity, type TokenReport } from './token-reporter';

// Imported by the root layout, so it runs at JS startup, on a background launch too: that launch
// only runs the root layout's imports, and iOS hands the tokens over then (#140).

const KEY_ITEM = 'oja.live-activity-key';
// A background launch can run on a locked phone, which a default keychain item won't open for.
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
/** A push-started activity can appear while the JS is running, and iOS says nothing to it. */
const SCAN_EVERY_MS = 2000;
const FIRST_PUSH_TO_START_IOS = 17.2;

const environment = ((Constants.expoConfig?.extra as { apnsEnvironment?: 'sandbox' | 'production' } | undefined)?.apnsEnvironment ??
  apnsEnvironment(undefined).host) as 'sandbox' | 'production';

const withKey = (key: string | null) => ({ fetchOptions: { headers: (key ? { [LIVE_ACTIVITY_KEY_HEADER]: key } : {}) as Record<string, string> } });

/** Posts with only the phone's key. Not through `storeClient`, whose 401 would sign the buyer out. */
const postWithKey = (path: string, key: string, body: object) =>
  fetch(`${env.apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-publishable-api-key': env.publishableKey, [LIVE_ACTIVITY_KEY_HEADER]: key },
    body: JSON.stringify(body),
  });

const reporter = tokenReporter({
  readKey: () => SecureStore.getItemAsync(KEY_ITEM, KEYCHAIN),
  saveKey: (key) => SecureStore.setItemAsync(KEY_ITEM, key, KEYCHAIN),
  clearKey: () => SecureStore.deleteItemAsync(KEY_ITEM, KEYCHAIN),
  register: async (key, pushToken) => {
    const { device } = await storeClient.store.liveActivityDevices.mutate({
      environment,
      ...(pushToken ? { push_token: pushToken } : {}),
      ...withKey(key),
    });
    return device.key;
  },
  remove: async (key) => {
    await storeClient.store.liveActivityDevices.current.delete(withKey(key));
  },
  post: async (key, report: TokenReport) => {
    const { status } = await postWithKey('/store/live-activity-tokens', key, { ...report, environment });
    if (status === 401) return 'revoked';
    return status >= 200 && status < 300 ? 'ok' : 'failed';
  },
  owed: async (key) => (await storeClient.store.liveActivities.owed.query(withKey(key))).activities as OwedActivity[],
  startActivity: (content: BuyerActivityContent, url) => {
    const activity = orderActivity.start(content, url);
    watch(activity);
    return activity.getId();
  },
  recordStarted: async (key, orderId, activityId) => {
    const { ok } = await postWithKey('/store/live-activities', key, { order_id: orderId, activity_id: activityId, environment });
    if (!ok) throw new Error(`Recording activity ${activityId} failed`);
  },
  startsActivitiesItself: () => Number.parseFloat(String(Platform.Version)) < FIRST_PUSH_TO_START_IOS,
  endActivities: () => {
    for (const activity of orderActivity.getInstances()) void activity.end('immediate').catch(() => {});
  },
});

/**
 * The shop order an activity is for, from the url the server or this app started it with. The
 * library doesn't expose it, so `patches/expo-widgets` adds `getUrl` (ADR 0018). Null once the activity has gone.
 */
function orderIdOf(activity: LiveActivity<BuyerActivityContent>) {
  try {
    return buyerActivityOrderId(activity.getUrl());
  } catch {
    return null;
  }
}

// Held for the life of the JS: the library cancels an activity's token observer when its object is released (#140).
const watched = new Map<string, LiveActivity<BuyerActivityContent>>();

function watch(activity: LiveActivity<BuyerActivityContent>) {
  const id = activity.getId();
  if (watched.has(id)) return;
  watched.set(id, activity);
  activity.addPushTokenListener(({ activityId, pushToken }) => {
    tokenSeen.add(activityId);
    reporter.activityToken(activityId, pushToken, orderIdOf(activity));
  });
}

/** Activities whose token has arrived this launch: until then, each scan asks again. */
const tokenSeen = new Set<string>();

async function askForToken(activity: LiveActivity<BuyerActivityContent>) {
  // Null until the buyer answers iOS's Allow prompt, which can take minutes or never come (#140).
  const token = await activity.getPushToken().catch(() => null);
  if (!token || tokenSeen.has(activity.getId())) return;
  tokenSeen.add(activity.getId());
  reporter.activityToken(activity.getId(), token, orderIdOf(activity));
}

function scan() {
  const running = orderActivity.getInstances();
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

export const liveActivityTokens = { ...reporter, available: true };
