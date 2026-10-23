import { acceptClockFraction, acceptClockTime, acceptTimeLeft, staffStatus, type ShopHours } from '@oja/domain';
import { StatusChip, TimeChip } from '@oja/ui';
import { View } from 'react-native';

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

/**
 * The accept clock on the order's own page, in its header: a plain sun pill with the time left,
 * "23h 58m", ember in the last two open hours. The list's chip carries the draining outline.
 */
export function AcceptClockPill({ acceptBy, now, hours }: Readonly<{ acceptBy: string; now: Date; hours: ShopHours | null }>) {
  const left = acceptTimeLeft(acceptBy, now, hours);
  return (
    <View accessible accessibilityRole="timer" accessibilityLabel={left.accessibilityLabel}>
      <StatusChip label={acceptClockTime(acceptBy, now, hours)} tone={left.urgent ? 'attention' : 'new'} icon="clock" />
    </View>
  );
}

/** A new order shows the time left to accept it; any other its state. */
export function FulfilmentChip({ fulfilment, now, hours }: ChipProps) {
  if (fulfilment.state === 'new' && fulfilment.accept_by) {
    return <AcceptClock acceptBy={fulfilment.accept_by} now={now} hours={hours} />;
  }
  return <StatusChip {...staffStatus(fulfilment.state)} />;
}
