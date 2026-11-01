// Throwaway #140 device test: reports every Live Activity token to a log server on the Mac.
import { addPushToStartTokenListener, type LiveActivity } from 'expo-widgets';
import { AppState, Platform } from 'react-native';

import { spikeActivity, type SpikeProps } from './spike-activity';

const url = process.env.EXPO_PUBLIC_LA_SPIKE_URL;

function report(kind: string, body: Record<string, unknown> = {}) {
  if (!url) return;
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, at: new Date().toISOString(), appState: AppState.currentState, ...body }),
  }).catch(() => {});
}

// Held for the life of the JS: the library cancels an activity's token observer when its object is released.
const watched = new Map<string, { activity: LiveActivity<SpikeProps>; tokenSeen: boolean }>();

function watch(activity: LiveActivity<SpikeProps>, via: string) {
  const activityId = activity.getId();
  if (watched.has(activityId)) return;
  watched.set(activityId, { activity, tokenSeen: false });
  report('activity-seen', { activityId, via });
  activity.addPushTokenListener((event) => report('activity-update-token', { ...event, via }));
}

// Asks each activity for its token again until it has one, in case the listener misses it.
function askForTokens() {
  for (const [activityId, entry] of watched) {
    if (entry.tokenSeen) continue;
    void entry.activity.getPushToken().then((token) => {
      if (!token || entry.tokenSeen) return;
      entry.tokenSeen = true;
      report('activity-get-push-token', { activityId, token });
    });
  }
}

function scan(via: string) {
  for (const activity of spikeActivity.getInstances()) watch(activity, via);
}

if (Platform.OS === 'ios' && url) {
  report('boot');
  addPushToStartTokenListener((event) => report('push-to-start-token', { ...event }));
  scan('boot');
  AppState.addEventListener('change', (state) => {
    report('app-state', { state });
    if (state === 'active') scan('foreground');
  });
  // A push-started activity can appear while the JS is already running.
  setInterval(() => {
    scan('poll');
    askForTokens();
  }, 1000);
}
