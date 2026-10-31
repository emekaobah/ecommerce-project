import { beforeEach, describe, expect, mock, test } from 'bun:test';

/** What each helper asked the router to do, in order. */
const calls: string[] = [];
mock.module('expo-router', () => ({
  router: {
    back: () => calls.push('back'),
    push: (to: unknown) => calls.push(`push ${typeof to === 'string' ? to : JSON.stringify(to)}`),
  },
}));

const { closeSheetThen, openCartSheet } = await import('./navigation');

beforeEach(() => {
  calls.length = 0;
});

describe('closeSheetThen', () => {
  test('closes the sheet before going on, so the next screen opens over the one under it', () => {
    closeSheetThen(() => calls.push('push /checkout'));

    expect(calls).toEqual(['back', 'push /checkout']);
  });
});

describe('openCartSheet', () => {
  test('opens the cart sheet over the current screen', () => {
    openCartSheet();

    expect(calls).toEqual(['push /cart-sheet']);
  });
});
