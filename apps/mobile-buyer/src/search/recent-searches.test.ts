import { describe, expect, mock, test } from 'bun:test';

// The hook's own collaborators; these tests exercise only how the list changes.
mock.module('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: false, userId: null }) }));
mock.module('expo-secure-store', () => ({}));

const { recentReducer } = await import('./recent-searches');

const start = { list: null, pending: [], changed: false };
const used = (search: string) => ({ type: 'used' as const, search });

describe('recentReducer', () => {
  test('a search used before Clerk says who is signed in joins that buyer’s list once it is read', () => {
    const before = recentReducer(start, { type: 'change', owner: undefined, change: used('garri') });

    expect(before.list).toBeNull();

    const read = recentReducer(before, { type: 'read', owner: 'user_1', stored: ['palm oil'] });

    expect(read.list).toEqual({ owner: 'user_1', searches: ['garri', 'palm oil'] });
    expect(read.changed).toBe(true);
  });

  test('a search used while the list is read joins it rather than replacing it', () => {
    const before = recentReducer(start, { type: 'change', owner: null, change: used('garri') });
    const read = recentReducer(before, { type: 'read', owner: null, stored: ['palm oil', 'ankara'] });

    expect(read.list?.searches).toEqual(['garri', 'palm oil', 'ankara']);
  });

  test("isn't kept when nothing was used before it was read", () => {
    expect(recentReducer(start, { type: 'read', owner: null, stored: ['palm oil'] }).changed).toBe(false);
  });

  test('a search used once the list is read is kept', () => {
    const read = recentReducer(start, { type: 'read', owner: null, stored: ['palm oil'] });
    const after = recentReducer(read, { type: 'change', owner: null, change: used('garri') });

    expect(after.list?.searches).toEqual(['garri', 'palm oil']);
    expect(after.changed).toBe(true);
  });

  test("one buyer's searches never join another's list", () => {
    const guest = recentReducer(start, { type: 'read', owner: null, stored: ['palm oil'] });
    const signedIn = recentReducer(guest, { type: 'change', owner: 'user_1', change: used('garri') });

    // The guest's list is still the one read: the buyer's search waits for theirs.
    expect(signedIn.list).toEqual({ owner: null, searches: ['palm oil'] });

    const read = recentReducer(signedIn, { type: 'read', owner: 'user_1', stored: [] });

    expect(read.list).toEqual({ owner: 'user_1', searches: ['garri'] });
  });
});
