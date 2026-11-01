import { describe, expect, mock, test } from 'bun:test';

import { vendorLiveUpdateMessage, type VendorLiveUpdateMessage } from '@oja/domain';

import { applyLiveUpdate } from './apply-live-update';

const content = { shop: 'Iya Bisi Foodstuff', counts: { new: 2, picking: 1, ready: 3, out: 4 }, deadline: '2026-11-01T14:12:08.000Z', urgent: false };
const message = (action: VendorLiveUpdateMessage['action']) =>
  vendorLiveUpdateMessage({ action, sellerId: 'sel_1', url: 'ojavendor://shop-orders/sel_1', content, at: 1000 });
const payload = (data: unknown) => ({ data: { dataString: JSON.stringify(data) } });
const ports = () => ({ show: mock(() => {}), cancel: mock(() => {}) });

describe('applyLiveUpdate', () => {
  test('a show draws the shop, to open its orders when tapped', () => {
    const phone = ports();
    applyLiveUpdate(payload(message('show')), phone);
    expect(phone.show).toHaveBeenCalledTimes(1);
    expect((phone.show.mock.calls as unknown[][])[0]![0]).toMatchObject({
      id: 'sel_1',
      title: '2 new orders to accept',
      url: 'ojavendor://shop-orders/sel_1',
      countdownTo: Date.parse('2026-11-01T14:12:08.000Z'),
      ongoing: true,
    });
  });

  test('a remove takes it away, at that revision', () => {
    const phone = ports();
    applyLiveUpdate(payload(message('remove')), phone);
    expect(phone.show).not.toHaveBeenCalled();
    expect(phone.cancel).toHaveBeenCalledWith('sel_1', 1000);
  });

  test("a new-order push isn't its business", () => {
    const phone = ports();
    applyLiveUpdate(payload({ url: '/orders/order_1' }), phone);
    expect(phone.show).not.toHaveBeenCalled();
    expect(phone.cancel).not.toHaveBeenCalled();
  });
});
