import { StatusChip, Text, useTheme } from '@oja/ui';
import { View } from 'react-native';

import type { Listing } from '@/api/listings';

export type ShopStatus = Listing['seller']['shop_status'];

/**
 * A shop's closed badge (ADR 0004), nothing while it is open: "Closed · opens 8am Mon" outside
 * its hours, when it still takes orders; "Closed until Tue 14 Oct" during a closure or pause,
 * when it doesn't. `withNote` adds the shop's note and what that means for ordering;
 * `delivered`, that delivery estimates count from the opening too.
 */
export function ShopStatusBadge({
  status,
  withNote,
  delivered,
}: Readonly<{ status: ShopStatus; withNote?: boolean; delivered?: boolean }>) {
  const theme = useTheme();
  if (status.state === 'open') return null;
  const note = status.state === 'closed_until' ? status.note : null;
  const countsFrom = delivered ? ', and delivery counts from then' : '';
  return (
    <View style={{ gap: theme.space[1], alignItems: 'flex-start' }}>
      <StatusChip label={status.label} tone={status.orderable ? 'warning' : 'danger'} icon="clock" />
      {withNote && note ? <Text tone="muted">“{note}”</Text> : null}
      {withNote ? (
        <Text tone="muted">
          {status.orderable
            ? `You can still order: it is prepared when the shop opens${countsFrom}.`
            : "You can't order from this shop until it reopens."}
        </Text>
      ) : null}
    </View>
  );
}
