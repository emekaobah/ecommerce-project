import { acceptTimeLeft } from '@oja/domain';
import { StatusChip, type StatusTone } from '@oja/ui';

import type { OrderFulfilment } from '@/api/orders';

const TONES: Partial<Record<OrderFulfilment['state'], StatusTone>> = {
  accepted: 'success',
  rejected: 'danger',
  cancelled: 'danger',
  delivered: 'success',
  ready_for_pickup: 'info',
  collected: 'success',
  not_collected: 'danger',
};

/** A new order shows the time left to accept it (counted in open hours); any other its state. */
export function FulfilmentChip({ fulfilment, now }: Readonly<{ fulfilment: OrderFulfilment; now: Date }>) {
  if (fulfilment.state === 'new' && fulfilment.accept_by) {
    const left = acceptTimeLeft(fulfilment.accept_by, now);
    return <StatusChip label={`New · ${left.label}`} tone={left.urgent ? 'danger' : 'warning'} icon="clock" />;
  }
  return <StatusChip label={stateLabel(fulfilment.state)} tone={TONES[fulfilment.state] ?? 'neutral'} />;
}

function stateLabel(state: OrderFulfilment['state']) {
  const words = state.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
