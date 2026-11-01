import { describe, expect, mock, test } from 'bun:test';

import { buyerActivityContent, buyerActivityUrl, buyerLiveUpdateMessage, type LiveUpdateMessage } from '@oja/domain';

import { applyLiveUpdate } from './apply-live-update';

const content = buyerActivityContent({ number: 'OJ-2412', shop: 'Iya Bisi Foodstuff', method: 'delivery', state: 'picking', currency_code: 'ngn' });
const message = (action: LiveUpdateMessage['action']) =>
  buyerLiveUpdateMessage({ action, orderId: 'order_1', url: buyerActivityUrl('oja', 'group_1', 'order_1'), content, at: 1000 });
const payload = (data: unknown) => ({ data: { dataString: JSON.stringify(data) } });
const ports = () => ({ show: mock(() => {}), cancel: mock(() => {}) });

describe('applyLiveUpdate', () => {
  test('a show draws the order, to open it when tapped', () => {
    const phone = ports();
    applyLiveUpdate(payload(message('show')), phone);
    expect(phone.show).toHaveBeenCalledTimes(1);
    expect((phone.show.mock.calls as unknown[][])[0]![0]).toMatchObject({
      id: 'order_1',
      title: 'Being prepared',
      url: 'oja://order/group_1?shop_order=order_1',
      ongoing: true,
    });
  });

  test("an end draws the order's final state", () => {
    const phone = ports();
    const delivered = buyerActivityContent({ number: 'OJ-2412', shop: 'Iya Bisi Foodstuff', method: 'delivery', state: 'delivered', currency_code: 'ngn' });
    applyLiveUpdate(payload({ ...message('end'), content: delivered }), phone);
    expect((phone.show.mock.calls as unknown[][])[0]![0]).toMatchObject({ title: 'Delivered', ongoing: false });
  });

  test('a remove takes it away, at that revision', () => {
    const phone = ports();
    applyLiveUpdate(payload(message('remove')), phone);
    expect(phone.show).not.toHaveBeenCalled();
    expect(phone.cancel).toHaveBeenCalledWith('order_1', 1000);
  });

  test("a normal push isn't its business", () => {
    const phone = ports();
    applyLiveUpdate(payload({ url: '/order/group_1' }), phone);
    expect(phone.show).not.toHaveBeenCalled();
    expect(phone.cancel).not.toHaveBeenCalled();
  });
});
