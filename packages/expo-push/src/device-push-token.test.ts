import { describe, expect, test } from 'bun:test';

import { pushPlatform, pushTokenSource, type PushModules } from './device-push-token';

/** The behaviour `pushTokenSource` asks for a notification that arrives with the app open. */
async function behaviourOf(content: { title: string | null; body: string | null }) {
  let handler: ((notification: unknown) => Promise<unknown>) | undefined;
  const modules = {
    Notifications: { setNotificationHandler: (h: { handleNotification: typeof handler }) => (handler = h.handleNotification) },
  } as unknown as PushModules;
  pushTokenSource(modules);
  return handler!({ request: { content } });
}

describe('with the app open', () => {
  test('a normal push shows', async () => {
    expect(await behaviourOf({ title: 'Order OJ-1 accepted', body: 'Being prepared' })).toMatchObject({ shouldShowBanner: true, shouldPlaySound: true });
  });

  test("a data-only message shows nothing: there'd be a blank notification", async () => {
    expect(await behaviourOf({ title: null, body: null })).toEqual({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false });
  });
});

describe('pushPlatform', () => {
  test('tells Android from everything else', () => {
    expect(pushPlatform('android')).toBe('android');
    expect(pushPlatform('ios')).toBe('ios');
  });
});
