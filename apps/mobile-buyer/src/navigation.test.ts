import { afterEach, beforeEach, describe, expect, jest, mock, test } from 'bun:test';

/** What each helper asked the router to do, in order. */
const calls: string[] = [];
mock.module('expo-router', () => ({
  router: {
    back: () => calls.push('back'),
    dismiss: (count: number) => calls.push(`dismiss ${count}`),
    push: (to: unknown) => calls.push(`push ${typeof to === 'string' ? to : JSON.stringify(to)}`),
  },
}));

const { backToCart, closeSheetThen, openCartSheet, stackSettled } = await import('./navigation');

beforeEach(() => {
  calls.length = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  // Nothing waits on the stack from one test to the next.
  stackSettled();
  jest.useRealTimers();
});

describe('closeSheetThen', () => {
  test('closes the sheet, and goes on only once it has gone, so the next screen opens over the one under it', () => {
    closeSheetThen(() => calls.push('push /checkout'));

    expect(calls).toEqual(['back']);

    stackSettled();

    expect(calls).toEqual(['back', 'push /checkout']);
  });

  test('goes on once, however many transitions end after', () => {
    closeSheetThen(() => calls.push('push /checkout'));

    stackSettled();
    stackSettled();
    jest.advanceTimersByTime(5000);

    expect(calls).toEqual(['back', 'push /checkout']);
  });

  test('ignores another tap while the sheet is closing, so the screen under it stays and opens one screen', () => {
    closeSheetThen(() => calls.push('push /checkout'));
    closeSheetThen(() => calls.push('push /product'));

    stackSettled();

    expect(calls).toEqual(['back', 'push /checkout']);

    closeSheetThen(() => calls.push('push /product'));

    expect(calls).toEqual(['back', 'push /checkout', 'back']);
  });

  test("goes on anyway if the stack never says it settled, so a tap isn't lost", () => {
    closeSheetThen(() => calls.push('push /checkout'));

    jest.advanceTimersByTime(5000);

    expect(calls).toEqual(['back', 'push /checkout']);
  });
});

describe('openCartSheet', () => {
  test('opens the cart sheet over the current screen', () => {
    openCartSheet();

    expect(calls).toEqual(['push /cart-sheet']);
  });
});

/** The root stack with checkout and its changes sheet over `under`. */
const overCheckout = (under: { name: string; state?: { index?: number; routes: { name: string }[] } }) => ({
  routes: [{ name: '(tabs)' }, under, { name: 'checkout/index' }, { name: 'checkout/changes' }],
});

describe('backToCart', () => {
  test('closes checkout and opens the cart sheet over the screen it started from, once checkout has gone', () => {
    backToCart(overCheckout({ name: 'product/[id]' }));

    expect(calls).toEqual(['dismiss 2']);

    stackSettled();

    expect(calls).toEqual(['dismiss 2', 'push /cart-sheet']);
  });

  test('only closes checkout when it started from the Cart tab, which is the cart', () => {
    backToCart({
      routes: [{ name: '(tabs)', state: { index: 2, routes: [{ name: 'index' }, { name: 'search' }, { name: 'cart' }] } }, { name: 'checkout/index' }, { name: 'checkout/changes' }],
    });
    stackSettled();

    expect(calls).toEqual(['dismiss 2']);
  });

  test('opens the cart sheet over another tab', () => {
    backToCart({
      routes: [{ name: '(tabs)', state: { index: 1, routes: [{ name: 'index' }, { name: 'search' }, { name: 'cart' }] } }, { name: 'checkout/index' }, { name: 'checkout/changes' }],
    });
    stackSettled();

    expect(calls).toEqual(['dismiss 2', 'push /cart-sheet']);
  });

  test('opens the cart sheet over the tabs before any tab was chosen: they start on Home', () => {
    backToCart({ routes: [{ name: '(tabs)' }, { name: 'checkout/index' }, { name: 'checkout/changes' }] });
    stackSettled();

    expect(calls).toEqual(['dismiss 2', 'push /cart-sheet']);
  });
});
