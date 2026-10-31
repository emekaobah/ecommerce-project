import { describe, expect, mock, test } from 'bun:test';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

type Settings = { cart_reminder_push: boolean; cart_reminder_email: boolean };

/** Each save the server is asked for, held until it is answered or refused. */
const saves: { body: Partial<Settings>; answer: (settings: Settings) => void; refuse: () => void }[] = [];
mock.module('./client', () => ({
  storeClient: {
    store: {
      customers: {
        me: {
          notificationPreferences: {
            mutate: (body: Partial<Settings>) =>
              new Promise((resolve, reject) =>
                saves.push({
                  body,
                  answer: (settings) => resolve({ notification_preferences: settings }),
                  refuse: () => reject(new Error('offline')),
                })
              ),
          },
        },
      },
    },
  },
}));

const { changeNotificationPreferenceOptions, notificationPreferenceKeys } = await import('./notification-preferences');

const ALL_ON: Settings = { cart_reminder_push: true, cart_reminder_email: true };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The Notifications screen showing these settings, and a switch on it to flip. */
function screenWith(settings: Settings) {
  saves.length = 0;
  const queryClient = new QueryClient();
  const key = notificationPreferenceKeys.me('user_1');
  queryClient.setQueryData(key, settings);
  const flip = (change: Partial<Settings>) => {
    const observer = new MutationObserver(queryClient, changeNotificationPreferenceOptions(queryClient, 'user_1'));
    observer.mutate(change).catch(() => {});
    return observer;
  };
  return { flip, shown: () => queryClient.getQueryData<Settings>(key) };
}

describe('changing a notification setting', () => {
  test('the switch shows the new setting while it saves', async () => {
    const screen = screenWith(ALL_ON);

    screen.flip({ cart_reminder_push: false });
    await settle();

    expect(saves.map((s) => s.body)).toEqual([{ cart_reminder_push: false }]);
    expect(screen.shown()).toEqual({ cart_reminder_push: false, cart_reminder_email: true });
  });

  test('a save that fails flips the switch back and says so', async () => {
    const screen = screenWith(ALL_ON);

    const push = screen.flip({ cart_reminder_push: false });
    await settle();
    saves[0]?.refuse();
    await settle();

    expect(screen.shown()).toEqual(ALL_ON);
    expect(push.getCurrentResult().isError).toBe(true);
  });

  test('a save that fails flips back only its own switch, not one that saved meanwhile', async () => {
    const screen = screenWith(ALL_ON);

    screen.flip({ cart_reminder_push: false });
    await settle();
    screen.flip({ cart_reminder_email: false });
    await settle();
    saves[1]?.answer({ cart_reminder_push: true, cart_reminder_email: false });
    saves[0]?.refuse();
    await settle();

    expect(screen.shown()).toEqual({ cart_reminder_push: true, cart_reminder_email: false });
  });

  test("a save that answers late doesn't undo a switch flipped after it", async () => {
    const screen = screenWith(ALL_ON);

    screen.flip({ cart_reminder_push: false });
    await settle();
    screen.flip({ cart_reminder_email: false });
    await settle();
    // The push save answers with the server's settings from before the email save.
    saves[0]?.answer({ cart_reminder_push: false, cart_reminder_email: true });
    await settle();

    expect(screen.shown()).toEqual({ cart_reminder_push: false, cart_reminder_email: false });
  });
});
