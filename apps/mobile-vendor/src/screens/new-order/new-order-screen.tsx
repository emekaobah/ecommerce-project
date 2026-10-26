import {
  acceptClockFraction,
  acceptTimeLeft,
  acceptWithinLabel,
  formatMoney,
  itemsLabel,
  takeoverAnnouncement,
  type ShopHours,
} from '@oja/domain';
import {
  AdirePattern,
  ErrorState,
  haptics,
  Icon,
  InlineNote,
  PhotoTile,
  PressableSurface,
  QuantityPill,
  Text,
  useTheme,
} from '@oja/ui';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFailureMessage } from '@/api/errors';
import { orderValue, useAcceptOrder, useOrder, type Order } from '@/api/orders';
import { useShopHours } from '@/api/shop-hours';
import { shopHoursOf } from '@/orders/shop-state';
import { useNow } from '@/orders/use-now';
import { takeoverAnswered, takeoverClosed, takeoverOpened } from '@/push/new-order-takeover';
import { useSession } from '@/session/session-store';

import { AlarmRing } from './alarm-ring';
import { useAlarm } from './use-alarm';

const itemCount = (order: Order) => (order.items ?? []).reduce((sum, item) => sum + Number(item.quantity), 0);

/**
 * A new order arriving while the app is open (#83, catalogue v-triage #2): the whole screen in
 * indigo, ringing and vibrating until it is answered. Accept order accepts it and opens it in
 * Picking; View order opens it to check its lines or reject it; Not now, in the corner, leaves it
 * in the New queue. An order no longer new (accepted on another phone, or past its deadline)
 * closes the takeover unseen.
 */
export function NewOrderScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const accept = useAcceptOrder(id);
  const shop = useShopHours(useSession()?.sellerId);
  const hours = shopHoursOf(shop.data);
  const now = useNow();
  const insets = useSafeAreaInsets();
  // Accept order, View order or Not now: the alarm stops at once, before anything else happens.
  const [answered, setAnswered] = useState(false);

  // Only what the server says now counts: a cached copy may still say New after someone accepted it.
  const data = order.isFetchedAfterMount ? order.data : undefined;
  const isNew = data?.fulfilment.state === 'new';
  const failed = useFailureMessage(
    accept.error,
    `Couldn't accept order #${data?.display_id ?? ''}. Check your connection and try again.`
  );
  useAlarm(!answered && (isNew || (Boolean(order.error) && !data)));

  useEffect(() => {
    takeoverOpened(id);
    return () => takeoverClosed(id);
  }, [id]);

  const openOrder = useCallback(() => router.replace({ pathname: '/orders/[id]', params: { id } }), [id, router]);

  // Accepted: the order opens in Picking, where the pick list starts.
  useEffect(() => {
    if (!accept.isSuccess) return;
    haptics.success();
    openOrder();
  }, [accept.isSuccess, openOrder]);

  // No longer New: unseen, it just closes (to Orders when it was the first screen); refused on
  // Accept (someone or the deadline moved it on), the order opens where it is now.
  useEffect(() => {
    if (!data || isNew || accept.isPending || accept.isSuccess) return;
    if (accept.isError) openOrder();
    else if (!answered) {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    }
  }, [data, isNew, accept.isPending, accept.isSuccess, accept.isError, answered, openOrder, router]);

  const announced = useRef(false);
  useEffect(() => {
    if (!isNew || !data || announced.current) return;
    announced.current = true;
    AccessibilityInfo.announceForAccessibility(
      takeoverAnnouncement(
        {
          displayId: data.display_id,
          method: data.fulfilment.method,
          itemCount: itemCount(data),
          total: formatMoney(orderValue(data), data.currency_code),
          acceptBy: data.fulfilment.accept_by,
        },
        now,
        hours
      )
    );
  }, [isNew, data, now, hours]);

  const answer = () => {
    setAnswered(true);
    takeoverAnswered(id);
  };
  const notNow = () => {
    answer();
    router.back();
  };
  const viewOrder = () => {
    answer();
    openOrder();
  };
  const acceptOrder = () => {
    answer();
    accept.mutate();
  };

  if (order.error && !order.data) {
    return (
      <View accessibilityViewIsModal style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
        <ErrorState
          title="Couldn't load the new order"
          body="Check your connection and try again. The order is waiting in New."
          error={order.error}
          onRetry={() => void order.refetch()}
          secondaryAction={{ label: 'Not now', onPress: notNow }}
        />
      </View>
    );
  }

  const acceptBy = isNew ? data.fulfilment.accept_by : null;
  const fraction = acceptBy ? acceptClockFraction(acceptBy, now, hours) : 1;

  return (
    <View accessibilityViewIsModal style={[styles.fill, { backgroundColor: theme.colors.band }]}>
      {/* Full at the top, gone 30% of the way down (the pattern fades out over 28-58% of its own height, a little under half the screen). */}
      <View style={[styles.pattern, { height: '45%' }]}>
        <AdirePattern fade="top" opacity={0.55} />
      </View>
      {/* Inset by hand: a full-screen modal sits outside the stack's safe-area frame. */}
      <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ScrollView
          bounces={false}
          contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[2], paddingBottom: theme.space[2] }}>
          <View style={[styles.row, styles.between, styles.top]}>
            <AlarmRing fraction={fraction} />
            <PressableSurface
              accessibilityRole="button"
              accessibilityLabel="Not now"
              accessibilityHint="Leaves the order in New"
              hitSlop={theme.space[2]}
              onPress={notNow}
              style={[styles.centre, { minHeight: theme.hitArea, paddingHorizontal: theme.space[1], borderRadius: theme.radius.sm }]}>
              <Text weight="extrabold" tone="onBand" style={styles.notNow}>
                Not now
              </Text>
            </PressableSurface>
          </View>
          {data ? <OrderSummary order={data} now={now} hours={hours} /> : null}
        </ScrollView>
        <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[6], paddingBottom: theme.space[2], gap: theme.space[2] }}>
          {failed ? <InlineNote>{failed}</InlineNote> : null}
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={failed ? `Try again to accept order #${data?.display_id ?? ''}` : 'Accept order'}
            accessibilityState={{ disabled: !isNew || accept.isPending, busy: accept.isPending }}
            disabled={!isNew || accept.isPending}
            onPress={acceptOrder}
            style={[styles.centre, { minHeight: theme.control.main, borderRadius: theme.radius.lg, backgroundColor: theme.colors.onBand }]}>
            {accept.isPending ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : (
              <Text variant="heading" style={{ color: theme.colors.primary }}>
                {failed ? 'Try again' : 'Accept order'}
              </Text>
            )}
          </PressableSurface>
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel="View order"
            accessibilityHint="Opens the order to check its lines or reject it"
            accessibilityState={{ disabled: accept.isPending }}
            disabled={accept.isPending}
            onPress={viewOrder}
            style={[styles.centre, { minHeight: theme.control.md, borderRadius: theme.radius.lg, backgroundColor: theme.colors.onBandAction }]}>
            <Text variant="strong" tone="onBand">
              View order
            </Text>
          </PressableSurface>
        </View>
      </View>
    </View>
  );
}

type SummaryProps = Readonly<{ order: Order; now: Date; hours: ShopHours | null }>;

/** "NEW ORDER · #1044 · DELIVERY", "3 items, ₦32,500", its lines and the time left to accept it. */
function OrderSummary({ order, now, hours }: SummaryProps) {
  const theme = useTheme();
  const { fulfilment, currency_code: currency } = order;
  const photo = theme.control.md;
  return (
    <>
      <Text
        variant="meta"
        weight="extrabold"
        style={{ marginTop: theme.space[6], color: theme.colors.onBandSoft, letterSpacing: theme.type.meta.fontSize * 0.08, textTransform: 'uppercase' }}>
        {`New order · #${order.display_id} · ${fulfilment.method}`}
      </Text>
      <Text variant="displayXl" tone="onBand" tabular style={{ marginTop: theme.space[2] }}>
        {`${itemsLabel(itemCount(order))},\n${formatMoney(orderValue(order), currency)}`}
      </Text>

      <View style={{ marginTop: theme.space[6], gap: theme.space[3] }}>
        {(order.items ?? []).map((item) => {
          const quantity = Number(item.quantity);
          const total = formatMoney(Number(item.unit_price) * quantity, currency);
          const name = item.product_title ?? 'Item';
          return (
            <View
              key={item.id}
              accessible
              accessibilityLabel={[`${quantity} × ${name}`, total, item.perishable ? 'Perishable' : null].filter(Boolean).join(', ')}
              style={[styles.row, { gap: theme.space[3] }]}>
              <PhotoTile style={{ width: photo, height: photo, padding: photo * 0.1, borderRadius: theme.radius.md }}>
                {item.thumbnail ? <Image source={{ uri: item.thumbnail }} contentFit="contain" style={styles.fill} /> : null}
              </PhotoTile>
              <View style={styles.fill}>
                <Text weight="bold" tone="onBand">
                  {name}
                </Text>
                <Text variant="meta" tabular style={{ color: theme.colors.onBandSoft }}>
                  {`${item.perishable ? 'Perishable · ' : ''}${total}`}
                </Text>
              </View>
              <QuantityPill label={`×${quantity}`} tone="onBand" />
            </View>
          );
        })}
      </View>

      {fulfilment.accept_by ? <AcceptWithin acceptBy={fulfilment.accept_by} now={now} hours={hours} /> : null}
    </>
  );
}

/** "Accept within 23h 58m", counted in the shop's open hours. */
function AcceptWithin({ acceptBy, now, hours }: Readonly<{ acceptBy: string; now: Date; hours: ShopHours | null }>) {
  const theme = useTheme();
  const left = acceptTimeLeft(acceptBy, now, hours);
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={left.accessibilityLabel}
      style={[styles.row, { marginTop: theme.space[4], gap: theme.space[2] }]}>
      <Icon name="clock" use="step" color={theme.colors.onBand} />
      <Text variant="meta" weight="bold" tone="onBand" tabular style={styles.fill}>
        {acceptWithinLabel(acceptBy, now, hours)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pattern: { position: 'absolute', top: 0, left: 0, right: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { justifyContent: 'space-between' },
  top: { alignItems: 'flex-start' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  notNow: { opacity: 0.9 },
});
