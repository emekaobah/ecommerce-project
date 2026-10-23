import { distanceLabel, shopStatusChip } from '@oja/domain';
import { StatusChip, Text, useTheme } from '@oja/ui';
import { StyleSheet, View } from 'react-native';

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
  return (
    <View style={{ gap: theme.space[1], alignItems: 'flex-start' }}>
      <StatusChip {...shopStatusChip(status.state, status.label)} />
      {withNote ? <ShopStatusNote status={status} delivered={delivered} /> : null}
    </View>
  );
}

/**
 * What a closed shop means for ordering, under its status: the shop's own note during a closure
 * or pause, then that an order is prepared when it opens, or can't be placed until it reopens.
 * Nothing while it is open.
 */
export function ShopStatusNote({ status, delivered }: Readonly<{ status: ShopStatus; delivered?: boolean }>) {
  const theme = useTheme();
  if (status.state === 'open') return null;
  const note = status.state === 'closed_until' ? status.note : null;
  const countsFrom = delivered ? ', and delivery counts from then' : '';
  return (
    <View style={{ gap: theme.space[1] }}>
      {note ? <Text tone="muted">“{note}”</Text> : null}
      <Text variant="meta" tone="muted">
        {status.orderable
          ? `You can still order: it is prepared when the shop opens${countsFrom}.`
          : "You can't order from this shop until it reopens."}
      </Text>
    </View>
  );
}

/**
 * A shop row's line under its name: "● Open · closes 7pm · 1 km" with "Open" in leaf, or the
 * grey "Closed · opens 10am Mon" chip, then the distance when the buyer has an address.
 */
export function ShopStatusLine({ status, distanceKm }: Readonly<{ status: ShopStatus; distanceKm: number | null }>) {
  const theme = useTheme();
  const distance = distanceKm == null ? '' : ` · ${distanceLabel(distanceKm)}`;
  if (status.state !== 'open') {
    return (
      <View style={[styles.line, { gap: theme.space[1] }]}>
        <StatusChip {...shopStatusChip(status.state, status.label)} />
        {distance ? (
          <Text variant="meta" tone="muted">
            {distance.slice(3)}
          </Text>
        ) : null}
      </View>
    );
  }
  // The label reads "Open · closes 7pm"; "Open" takes the leaf colour and its dot.
  const rest = status.label.replace(/^Open/, '');
  return (
    <View accessible accessibilityLabel={`${status.label}${distance}`} style={[styles.line, { gap: theme.space[1] }]}>
      <View style={[styles.dot, { width: theme.space[2], height: theme.space[2], backgroundColor: theme.colors.leafText }]} />
      <Text variant="meta" tone="muted" style={styles.shrink}>
        <Text variant="label" weight="extrabold" tone="leaf">
          Open
        </Text>
        {`${rest}${distance}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  dot: { borderRadius: 999 },
  shrink: { flexShrink: 1 },
});
