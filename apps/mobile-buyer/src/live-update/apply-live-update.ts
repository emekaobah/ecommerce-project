import { buyerLiveUpdateView, readBuyerLiveUpdateMessage, type LiveUpdateView } from '@oja/domain';

export type LiveUpdatePorts = {
  show: (view: LiveUpdateView) => void;
  cancel: (id: string, revision: number) => void;
};

/** What a data-only push from the backend does to the order's notification. Anything else that arrives is left alone. */
export function applyLiveUpdate(payload: unknown, { show, cancel }: LiveUpdatePorts): void {
  const message = readBuyerLiveUpdateMessage(payload);
  if (!message) return;
  if (message.action === 'remove') cancel(message.order_id, message.revision);
  else show(buyerLiveUpdateView(message));
}
