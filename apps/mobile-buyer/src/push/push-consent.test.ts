import { describe, expect, test } from 'bun:test';

import { shouldAskPushConsent } from './push-consent';

describe('shouldAskPushConsent', () => {
  test('asks a signed-in buyer whose phone has never asked for notification permission', () => {
    expect(shouldAskPushConsent({ signedIn: true, permission: 'undetermined', pushesCanArrive: true })).toBe(true);
  });

  test.each(['granted', 'denied'] as const)('skips it once the buyer has %s notifications', (permission) => {
    expect(shouldAskPushConsent({ signedIn: true, permission, pushesCanArrive: true })).toBe(false);
  });

  test('never shows it to a guest', () => {
    expect(shouldAskPushConsent({ signedIn: false, permission: 'undetermined', pushesCanArrive: true })).toBe(false);
  });

  test('skips it where no push can arrive, so a simulator or a build without push is not asked every launch', () => {
    expect(shouldAskPushConsent({ signedIn: true, permission: 'undetermined', pushesCanArrive: false })).toBe(false);
  });
});
