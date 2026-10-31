import { beforeEach, describe, expect, mock, test } from 'bun:test';

// The phone's keychain, as a map; `failing` makes it unreadable and unwritable.
const keychain = new Map<string, string>();
let failing = false;
let made = 0;
mock.module('expo-secure-store', () => ({
  getItemAsync: async (key: string) => {
    if (failing) throw new Error('keychain locked');
    return keychain.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    if (failing) throw new Error('keychain locked');
    keychain.set(key, value);
  },
}));
mock.module('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-00000000000${++made}` }));

const { readSearchPhoneId } = await import('./search-phone-id');

describe('readSearchPhoneId', () => {
  beforeEach(() => {
    keychain.clear();
    failing = false;
  });

  test('makes the phone an id once, keeps it, and gives the same one after the app restarts', async () => {
    const first = await readSearchPhoneId({ fresh: true });
    const again = await readSearchPhoneId();
    const afterRestart = await readSearchPhoneId({ fresh: true });

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(again).toBe(first);
    expect(afterRestart).toBe(first);
  });

  test('a keychain that can’t be read still gives an id, for this session only', async () => {
    failing = true;

    const id = await readSearchPhoneId({ fresh: true });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readSearchPhoneId()).toBe(id);
  });
});
