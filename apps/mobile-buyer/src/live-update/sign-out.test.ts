import { expect, mock, test } from 'bun:test';

import { buyerActivityContent, buyerActivityUrl, buyerLiveUpdateMessage } from '@oja/domain';

// A Live Update message that lands after its person signed out isn't drawn (#133). The native
// module is faked only to record what the task asks it to do.

const native = { show: mock((_view: unknown) => {}), cancel: mock(() => {}), cancelAll: mock(() => {}) };
const liveUpdateDir = Bun.resolveSync('@oja/expo-live-update', import.meta.dir).replace(/\/[^/]+$/, '');
mock.module('expo', () => ({ requireOptionalNativeModule: () => native }));
mock.module(Bun.resolveSync('expo', liveUpdateDir), () => ({ requireOptionalNativeModule: () => native }));

test('a message arriving after sign-out, or once someone else signed in, is not drawn', async () => {
  const { registerLiveUpdateTask, cancelAllLiveUpdates } = await import('@oja/expo-live-update');
  const { applyLiveUpdate } = await import('./apply-live-update');

  let task: ((body: { data: unknown; error: unknown }) => Promise<void>) | undefined;
  const keychain = new Map<string, string>([['oja.live-update.session', 'ada_session']]);
  const SecureStore = {
    getItemAsync: async (key: string) => keychain.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => void keychain.set(key, value),
    deleteItemAsync: async (key: string) => void keychain.delete(key),
  };
  const { endLiveUpdateSession } = await import('@oja/expo-live-update');
  registerLiveUpdateTask({
    TaskManager: { defineTask: (_name: string, handler: any) => (task = handler) } as any,
    Notifications: { registerTaskAsync: () => Promise.resolve() } as any,
    SecureStore,
    apply: applyLiveUpdate,
  });

  const content = buyerActivityContent({ number: 'OJ-1', shop: 'Iya Bisi', method: 'pickup', state: 'ready_for_pickup', currency_code: 'ngn', pickup_code: '4821' });
  const late = { ...buyerLiveUpdateMessage({ action: 'show', orderId: 'order_ada', url: buyerActivityUrl('oja', 'g', 'order_ada'), content, at: 1000 }), session: 'ada_session' };

  // Ada signs out: what push-registration.ts and register.ts do on Android.
  await endLiveUpdateSession(SecureStore);
  cancelAllLiveUpdates();
  expect(native.cancelAll).toHaveBeenCalledTimes(1);

  // The message Firebase was still holding arrives.
  await task!({ data: { data: { dataString: JSON.stringify(late) } }, error: null });

  // Ben signs in on the phone, and a message still for Ada arrives.
  keychain.set('oja.live-update.session', 'ben_session');
  await task!({ data: { data: { dataString: JSON.stringify(late) } }, error: null });

  expect(native.show).not.toHaveBeenCalled();
});
