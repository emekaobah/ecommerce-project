import { acceptClockStatus, staffStatus } from '@oja/domain';
import { StatusChip } from '@oja/ui';

import type { OrderFulfilment } from '@/api/orders';

/** A new order shows the time left to accept it (counted in open hours); any other its state. */
export function FulfilmentChip({ fulfilment, now }: Readonly<{ fulfilment: OrderFulfilment; now: Date }>) {
  if (fulfilment.state === 'new' && fulfilment.accept_by) {
    const clock = acceptClockStatus(fulfilment.accept_by, now);
    return <StatusChip {...clock} label={`New · ${clock.label}`} />;
  }
  return <StatusChip {...staffStatus(fulfilment.state)} />;
}
