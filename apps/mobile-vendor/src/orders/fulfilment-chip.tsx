import { acceptClockFraction, acceptTimeLeft, staffStatus, type ShopHours } from '@oja/domain';
import { StatusChip, TimeChip } from '@oja/ui';

import type { OrderFulfilment } from '@/api/orders';

type ChipProps = Readonly<{ fulfilment: OrderFulfilment; now: Date; hours: ShopHours | null }>;

/**
 * A new order's accept clock: the open time left, its outline draining over the 24 open hours
 * and ember in the last two, when the reminder push goes.
 */
export function AcceptClock({ acceptBy, now, hours }: Readonly<{ acceptBy: string; now: Date; hours: ShopHours | null }>) {
  const left = acceptTimeLeft(acceptBy, now, hours);
  return (
    <TimeChip
      label={left.label}
      accessibilityLabel={left.accessibilityLabel}
      urgent={left.urgent}
      fraction={acceptClockFraction(acceptBy, now, hours)}
    />
  );
}

/** Whether a new order is in its last two open hours to accept. */
export const acceptUrgent = (fulfilment: OrderFulfilment, now: Date, hours: ShopHours | null) =>
  fulfilment.state === 'new' && !!fulfilment.accept_by && acceptTimeLeft(fulfilment.accept_by, now, hours).urgent;

/** A new order shows the time left to accept it; any other its state. */
export function FulfilmentChip({ fulfilment, now, hours }: ChipProps) {
  if (fulfilment.state === 'new' && fulfilment.accept_by) {
    return <AcceptClock acceptBy={fulfilment.accept_by} now={now} hours={hours} />;
  }
  return <StatusChip {...staffStatus(fulfilment.state)} />;
}
