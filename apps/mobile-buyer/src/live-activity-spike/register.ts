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

const watched = new Set<string>();

function watch(activity: LiveActivity<SpikeProps>, via: string) {
  const activityId = activity.getId();
  if (watched.has(activityId)) return;
  watched.add(activityId);
  report('activity-seen', { activityId, via });
  activity.addPushTokenListener((event) => report('activity-update-token', { ...event, via }));
  void activity.getPushToken().then((token) => report('activity-get-push-token', { activityId, token, via }));
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
  setInterval(() => scan('poll'), 5000);
}
