import { describe, expect, test } from 'bun:test';

import { cartLineListing } from './cart-line-listing';

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
