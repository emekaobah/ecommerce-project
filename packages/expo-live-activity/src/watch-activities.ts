import type { AppState } from 'react-native';

/** Passed in by each app, so the app's own copy of each native module is the one used (ADR 0012). */
export type WatchModules = {
  addPushToStartTokenListener: (listener: (event: { activityPushToStartToken: string }) => void) => unknown;
  AppState: typeof AppState;
};

/** What this needs of `expo-widgets`' `LiveActivity`, whichever copy of the library the app has. */
export type WatchedActivity = {
  getId(): string;
  getUrl(): string | null;
  getPushToken(): Promise<string | null>;
  addPushTokenListener(listener: (event: { activityId: string; pushToken: string }) => void): unknown;
};

/** A push-started activity can appear while the JS is running, and iOS says nothing to it. */
const SCAN_EVERY_MS = 2000;

/**
 * Hands the reporter every token iOS has for these activities. Call it at JS startup, on a
 * background launch too: that launch only runs the root layout's imports, and iOS hands the tokens
 * over then (#140). Answers `watch`, for an activity the app started itself.
 */
export function watchActivities({
  modules,
  activities,
  subjectOf,
  reporter,
}: {
  modules: WatchModules;
  activities: () => WatchedActivity[];
  /** What the activity's url names (ADR 0018), read with the `patches/expo-widgets` `getUrl`. */
  subjectOf: (url: string | null) => string | null;
  reporter: {
    activityToken: (activityId: string, token: string, subject: string | null) => void;
    pushToStartToken: (token: string) => void;
    retry: () => void;
  };
}) {
  // Held for the life of the JS: the library cancels an activity's token observer when its object is released (#140).
  const watched = new Map<string, WatchedActivity>();
  /** Activities whose token has arrived this launch: until then, each scan asks again. */
  const tokenSeen = new Set<string>();

  /** Null once the activity has gone. */
  const subject = (activity: WatchedActivity) => {
    try {
      return subjectOf(activity.getUrl());
    } catch {
      return null;
    }
  };

  function watch(activity: WatchedActivity) {
    const id = activity.getId();
    if (watched.has(id)) return;
    watched.set(id, activity);
    activity.addPushTokenListener(({ activityId, pushToken }) => {
      tokenSeen.add(activityId);
      reporter.activityToken(activityId, pushToken, subject(activity));
    });
  }

  async function askForToken(activity: WatchedActivity) {
    // Null until the person answers iOS's Allow prompt, which can take minutes or never come (#140).
    const token = await activity.getPushToken().catch(() => null);
    if (!token || tokenSeen.has(activity.getId())) return;
    tokenSeen.add(activity.getId());
    reporter.activityToken(activity.getId(), token, subject(activity));
  }

  function scan() {
    const running = activities();
    for (const activity of running) {
      watch(activity);
      if (!tokenSeen.has(activity.getId())) void askForToken(activity);
    }
    const ids = new Set(running.map((activity) => activity.getId()));
    for (const id of watched.keys()) if (!ids.has(id)) watched.delete(id);
  }

  // iOS issues the push-to-start token only once a listener is added, so the app must have been opened once.
  modules.addPushToStartTokenListener(({ activityPushToStartToken }) => reporter.pushToStartToken(activityPushToStartToken));
  scan();
  setInterval(scan, SCAN_EVERY_MS);
  modules.AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      scan();
      reporter.retry();
    }
  });

  return { watch };
}
