import { beforeEach, describe, expect, mock, test } from 'bun:test';

/** What each helper asked the router to do, in order. */
const calls: string[] = [];
mock.module('expo-router', () => ({
  router: {
    back: () => calls.push('back'),
    push: (to: unknown) => calls.push(`push ${typeof to === 'string' ? to : JSON.stringify(to)}`),
  },
}));

const { cartLineListing, closeSheetThen, openCartSheet } = await import('./navigation');

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

describe('cartLineListing', () => {
  test("is the line's product in its shop", () => {
    expect(cartLineListing({ seller: { id: 'sel_1' } }, { product_id: 'prod_1' })).toEqual({
      seller: { id: 'sel_1' },
      product: { id: 'prod_1' },
    });
  });

  test("is nothing once the shop stopped selling it, so the line doesn't open", () => {
    expect(cartLineListing({ seller: null }, { product_id: 'prod_1' })).toBeNull();
  });

  test('is nothing for a line with no product', () => {
    expect(cartLineListing({ seller: { id: 'sel_1' } }, { product_id: null })).toBeNull();
  });
});
