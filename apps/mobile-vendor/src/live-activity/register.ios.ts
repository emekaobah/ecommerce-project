import { LIVE_ACTIVITY_KEY_HEADER, vendorActivitySellerId } from '@oja/domain';
import { addPushToStartTokenListener, type LiveActivity } from 'expo-widgets';
import { AppState, Platform } from 'react-native';

import { env } from '@/config/env';

import { phoneReporter } from './phone-reporter';
import { shopActivity, type ShopActivityContent } from './shop-activity';
import type { TokenReport } from './token-reporter';

// Imported by the root layout, so it runs at JS startup, on a background launch too: that launch
// only runs the root layout's imports, and iOS hands the tokens over then (#140).

/** A push-started activity can appear while the JS is running, and iOS says nothing to it. */
const SCAN_EVERY_MS = 2000;
/** The server starts this app's activities by push, which iOS only allows from here. */
const FIRST_PUSH_TO_START_IOS = 17.2;

const reporter = phoneReporter({
  // Only the phone's key. Not through `vendorClient`, whose 401 would sign the member out.
  post: async (key, report: TokenReport, environment) => {
    const { status } = await fetch(`${env.apiUrl}/vendor/live-activity-tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [LIVE_ACTIVITY_KEY_HEADER]: key },
      body: JSON.stringify({ ...report, environment }),
    });
    if (status === 401) return 'revoked';
    return status >= 200 && status < 300 ? 'ok' : 'failed';
  },
  endActivities: () => {
    for (const activity of shopActivity.getInstances()) void activity.end('immediate').catch(() => {});
  },
});

/**
 * The shop an activity is for, from the url the server started it with. The library doesn't expose
 * it, so `patches/expo-widgets` adds `getUrl` (ADR 0018). Null once the activity has gone.
 */
function shopOf(activity: LiveActivity<ShopActivityContent>) {
  try {
    return vendorActivitySellerId(activity.getUrl());
  } catch {
    return null;
  }
}

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
    reporter.activityToken(activityId, pushToken, shopOf(activity));
  });
}

async function askForToken(activity: LiveActivity<ShopActivityContent>) {
  // Null until the member answers iOS's Allow prompt, which can take minutes or never come (#140).
  const token = await activity.getPushToken().catch(() => null);
  if (!token || tokenSeen.has(activity.getId())) return;
  tokenSeen.add(activity.getId());
  reporter.activityToken(activity.getId(), token, shopOf(activity));
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
  /** Android links its Expo token to the phone: iOS's activities don't go through Expo. */
  pushTokenRegistered(_token: string) {},
  /** Whether this phone can run the shop's activity, so the switch shows. */
  available: Number.parseFloat(String(Platform.Version)) >= FIRST_PUSH_TO_START_IOS,
};
