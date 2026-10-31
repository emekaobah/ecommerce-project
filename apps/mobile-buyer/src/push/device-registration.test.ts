import { describe, expect, test } from 'bun:test';

import type { NotificationPermission } from './push-consent';
import { deviceRegistration } from './device-registration';

/** A deferred value: `answer` resolves what the code under test is awaiting. */
function held<T>() {
  let answer!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (answer = resolve));
  return { promise, answer };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The server's view: which tokens get this buyer's pushes. */
function fakeDevice(permission: () => Promise<NotificationPermission>) {
  const registeredTokens = new Set<string>();
  const consentShown: number[] = [];
  const registration = deviceRegistration({
    permission,
    pushesCanArrive: () => true,
    pushToken: async () => 'ExponentPushToken[ada]',
    add: async (token) => void registeredTokens.add(token),
    remove: async (token) => void registeredTokens.delete(token),
    askConsent: () => consentShown.push(1),
  });
  return { registration, registeredTokens, consentShown };
}

describe('deviceRegistration', () => {
  test('registers straight away where the phone already allowed notifications', async () => {
    const { registration, registeredTokens } = fakeDevice(async () => 'granted');

    registration.registerOrAskConsent();
    await settle();

    expect([...registeredTokens]).toEqual(['ExponentPushToken[ada]']);
  });

  test('a sign-out while the permission is still being read leaves no token registered', async () => {
    const permission = held<NotificationPermission>();
    const { registration, registeredTokens } = fakeDevice(() => permission.promise);

    registration.registerOrAskConsent();
    const signedOut = registration.forgetDevice();
    permission.answer('granted');
    await signedOut;
    await settle();

    expect([...registeredTokens]).toEqual([]);
  });

  test('a sign-out while the permission is being read never shows the consent screen', async () => {
    const permission = held<NotificationPermission>();
    const { registration, consentShown } = fakeDevice(() => permission.promise);

    registration.registerOrAskConsent();
    const signedOut = registration.forgetDevice();
    permission.answer('undetermined');
    await signedOut;
    await settle();

    expect(consentShown).toEqual([]);
  });

  test('signing out removes a token registered earlier', async () => {
    const { registration, registeredTokens } = fakeDevice(async () => 'granted');

    registration.registerOrAskConsent();
    await settle();
    await registration.forgetDevice();

    expect([...registeredTokens]).toEqual([]);
  });

  test('the buyer continuing past the consent screen registers the device', async () => {
    const { registration, registeredTokens, consentShown } = fakeDevice(async () => 'undetermined');

    registration.registerOrAskConsent();
    await settle();
    registration.registerAfterConsent();
    await settle();

    expect(consentShown).toEqual([1]);
    expect([...registeredTokens]).toEqual(['ExponentPushToken[ada]']);
  });
});
