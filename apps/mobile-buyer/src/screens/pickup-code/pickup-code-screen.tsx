import { useAuth } from '@clerk/expo';
import { orderNumber, pickupCodeCollectByLabel, todayHoursLabel } from '@oja/domain';
import { Band, EmptyState, ErrorState, Icon, PressableSurface, Skeleton, StatusChip, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isNotFound } from '@/api/errors';
import { useOrderGroup, type SellerOrder } from '@/api/orders';
import { PickupCode, usePickupQrSide } from '@/components/pickup';

/** Back to the order the screen was opened from, or to it afresh when opened on its own. */
function close(groupId: string) {
  if (router.canGoBack()) router.back();
  else router.replace({ pathname: '/order/[id]', params: { id: groupId } });
}

/**
 * A pickup order's code, full screen, to show at the shop's counter (#80): the indigo band with
 * a big QR code and the digits, then when to collect by, today's hours and where. Opened from
 * order detail's "Show pickup code" on a shop's order that is Ready for pickup.
 */
export function PickupCodeScreen({ groupId, orderId }: Readonly<{ groupId: string; orderId: string }>) {
  const theme = useTheme();
  const { userId } = useAuth();
  const group = useOrderGroup(userId, groupId);
  const order = group.data?.orders.find((o) => o.id === orderId) ?? null;

  let content: ReactNode;
  if (group.error && !group.data && isNotFound(group.error)) {
    content = <NoCode order={null} groupId={groupId} />;
  } else if (group.error && !group.data) {
    content = (
      <ErrorState
        title="Couldn't load your pickup code"
        body="Check your connection and try again. Your order is still held for you."
        error={group.error}
        onRetry={() => void group.refetch()}
        secondaryAction={{ label: 'Back to the order', onPress: () => close(groupId) }}
      />
    );
  } else if (!group.data) {
    content = <PickupSkeleton />;
  } else if (!order?.pickup?.code) {
    content = <NoCode order={order} groupId={groupId} />;
  } else {
    content = <PickupCodeView order={order} code={order.pickup.code} groupId={groupId} />;
  }
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="light" />
      {content}
    </View>
  );
}

/** The band's top row: back to the order, named by its number, and the order's state. */
function TopRow({ label, groupId, chip }: Readonly<{ label: string; groupId: string; chip?: ReactNode }>) {
  const theme = useTheme();
  return (
    <View style={[styles.between, { gap: theme.space[2] }]}>
      <PressableSurface
        accessibilityRole="button"
        accessibilityLabel={`Back to ${label}`}
        onPress={() => close(groupId)}
        style={[styles.row, { minHeight: theme.hitArea, gap: theme.space[1], paddingRight: theme.space[2] }]}>
        <Icon name="back" color={theme.colors.onBand} />
        <Text weight="bold" tone="onBand">
          {label}
        </Text>
      </PressableSurface>
      {chip}
    </View>
  );
}

function PickupCodeView({ order, code, groupId }: Readonly<{ order: SellerOrder; code: string; groupId: string }>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pickup = order.pickup!;
  const { address } = pickup;
  const collectBy = order.fulfilment.collect_by;
  const street = [address.address_1, address.address_2].filter(Boolean).join(', ');
  const place = [street, address.city].filter(Boolean).join(', ');
  const query = [street, address.city, address.province].filter(Boolean).join(', ');
  const openMap = () =>
    void Linking.openURL(Platform.OS === 'ios' ? `maps:?q=${encodeURIComponent(query)}` : `geo:0,0?q=${encodeURIComponent(query)}`);
  const hours = todayHoursLabel(pickup.today);
  // Collect by when, with today's hours under it; today's hours alone if the hold has no end.
  const when = collectBy ? pickupCodeCollectByLabel(collectBy.at, new Date(), collectBy.time_zone) : hours;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + theme.space[6] }}>
      <Band style={{ paddingTop: insets.top + theme.space[2], paddingBottom: theme.space[6] }}>
        <TopRow label={orderNumber(order.display_id)} groupId={groupId} chip={<StatusChip label="Ready" tone="success" icon="store" />} />
        <Text variant="titleNamed" tone="onBand">{`Show this at ${order.seller.name}`}</Text>
        <PickupCode code={code} />
      </Band>
      {when ? <InfoRow icon="clock" title={when} subtitle={collectBy ? hours : null} /> : null}
      <InfoRow
        icon="pin"
        title={place}
        subtitle={[address.landmark, pickup.instructions].filter(Boolean).join(' · ') || null}
        action={query ? { label: 'Map', hint: 'Opens the address in your maps app', onPress: openMap } : undefined}
      />
    </ScrollView>
  );
}

/** A row under the band (`.lrow`): its symbol, what it says and, at its end, what it opens. */
function InfoRow({
  icon,
  title,
  subtitle,
  action,
}: Readonly<{
  icon: 'clock' | 'pin';
  title: string;
  subtitle?: string | null;
  action?: { label: string; hint: string; onPress: () => void };
}>) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { gap: theme.space[3], paddingVertical: theme.space[3], paddingHorizontal: theme.space[4] }]}>
      <Icon name={icon} color={theme.colors.accent} />
      <View style={[styles.fill, { gap: theme.space[1] }]}>
        <Text weight="bold">{title}</Text>
        {subtitle ? (
          <Text variant="meta" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? (
        <PressableSurface
          accessibilityRole="link"
          accessibilityHint={action.hint}
          onPress={action.onPress}
          style={[styles.centre, { minHeight: theme.hitArea, minWidth: theme.hitArea }]}>
          <Text variant="meta" weight="bold" tone="link">
            {action.label}
          </Text>
        </PressableSurface>
      ) : null}
    </View>
  );
}

/** The order has no code to show: not ready yet, collected, or no longer one of the group's. */
function NoCode({ order, groupId }: Readonly<{ order: SellerOrder | null; groupId: string }>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const state = order?.fulfilment.state;
  let title = 'No pickup code right now';
  let body = 'Your code appears here when the shop has your order ready.';
  if (!order) {
    title = 'Order not found';
    body = "This order isn't one of yours.";
  } else if (state === 'collected') {
    title = 'Already collected';
    body = 'You collected this order, so its code is no longer needed.';
  } else if (state === 'not_collected') {
    title = 'Not collected in time';
    body = 'The shop stopped holding this order. The order shows your refund.';
  }
  return (
    <View style={styles.fill}>
      <Band style={{ paddingTop: insets.top + theme.space[2] }}>
        <TopRow label={order ? orderNumber(order.display_id) : 'Order'} groupId={groupId} />
      </Band>
      <EmptyState
        title={title}
        body={body}
        icon="store"
        action={
          order
            ? { label: 'Back to the order', onPress: () => close(groupId) }
            : { label: 'See your orders', onPress: () => router.replace('/(tabs)/orders') }
        }
      />
    </View>
  );
}

/** The screen's shape while the order loads: the band with the QR's square and the digits. */
function PickupSkeleton() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const side = usePickupQrSide();
  return (
    <View accessible accessibilityLabel="Loading your pickup code" style={styles.fill}>
      <Band style={{ paddingTop: insets.top + theme.space[2], paddingBottom: theme.space[6] }}>
        <View style={{ height: theme.hitArea }} />
        <Skeleton width="70%" height={theme.type.titleNamed.lineHeight} />
        <View style={[styles.centre, { gap: theme.space[3] }]}>
          <Skeleton width={side} height={side} radius="xl" />
          <Skeleton width="60%" height={theme.type.displayXxl.lineHeight} />
        </View>
      </Band>
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <Skeleton width="60%" height={theme.type.body.lineHeight} />
        <Skeleton width="40%" height={theme.type.meta.lineHeight} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
