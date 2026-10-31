import { skipToken, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { storeClient } from './client';

export const notificationPreferenceKeys = {
  all: ['notification-preferences'] as const,
  /** Keyed by Clerk user so one buyer never sees another's settings. */
  me: (userId: string) => [...notificationPreferenceKeys.all, { userId }] as const,
};

async function fetchNotificationPreferences() {
  const { notification_preferences } = await storeClient.store.customers.me.notificationPreferences.query();
  return notification_preferences;
}

/** The buyer's notification settings (#138), kept on the server so they hold on any phone. */
export type NotificationPreferences = Awaited<ReturnType<typeof fetchNotificationPreferences>>;
export type NotificationPreferencesChange = Partial<NotificationPreferences>;

/** The signed-in buyer's notification settings. */
export function useNotificationPreferences(userId: string | null | undefined) {
  return useQuery({
    queryKey: notificationPreferenceKeys.me(userId ?? ''),
    queryFn: userId ? fetchNotificationPreferences : skipToken,
  });
}

const keysOf = (change: NotificationPreferencesChange) => Object.keys(change) as (keyof NotificationPreferences)[];

/**
 * The shown settings with each setting `change` named taken from `from`, but only where the
 * switch still shows what the change set: one flipped again since is left as it is.
 */
const settleChange = (
  shown: NotificationPreferences,
  change: NotificationPreferencesChange,
  from: NotificationPreferences,
): NotificationPreferences => {
  const next = { ...shown };
  for (const name of keysOf(change)) if (shown[name] === change[name]) next[name] = from[name];
  return next;
};

/**
 * Turning a setting on or off: the switch moves at once and the change saves. A save that fails
 * puts its switch back, unless it was flipped again since; one that succeeds keeps the server's
 * word for its own setting only, so a slower answer never undoes another switch flipped meanwhile.
 */
export function changeNotificationPreferenceOptions(queryClient: QueryClient, userId: string) {
  const key = notificationPreferenceKeys.me(userId);
  const update = (apply: (shown: NotificationPreferences) => NotificationPreferences) =>
    queryClient.setQueryData<NotificationPreferences>(key, (shown) => (shown ? apply(shown) : shown));
  return {
    mutationFn: async (change: NotificationPreferencesChange) =>
      (await storeClient.store.customers.me.notificationPreferences.mutate(change)).notification_preferences,
    onMutate: async (change: NotificationPreferencesChange) => {
      // A load in flight would answer with the settings from before the change.
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<NotificationPreferences>(key);
      update((shown) => ({ ...shown, ...change }));
      return { before };
    },
    onError: (_error: unknown, change: NotificationPreferencesChange, context: { before?: NotificationPreferences } | undefined) => {
      const before = context?.before;
      if (!before) return;
      update((shown) => settleChange(shown, change, before));
    },
    onSuccess: (saved: NotificationPreferences, change: NotificationPreferencesChange) => {
      update((shown) => settleChange(shown, change, saved));
    },
  };
}

/** Turns one of the buyer's notification settings on or off. */
export function useChangeNotificationPreference(userId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation(changeNotificationPreferenceOptions(queryClient, userId ?? ''));
}
