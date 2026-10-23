import { useAuth } from '@clerk/expo';
import {
  collectByLabel,
  courierChangedNote,
  formatMoney,
  missingItemsNote,
  openingLabel,
  orderArrival,
  orderCardStatus,
  orderGroupSettled,
  orderGroupSummary,
  orderLineName,
  orderNumber,
  orderProgress,
  PICKUP_HOLD_NOTICE,
  reachedOnLabel,
} from '@oja/domain';
import {
  Band,
  Button,
  ErrorState,
  Group,
  GroupList,
  InlineNote,
  ListRow,
  PressableSurface,
  ShopMark,
  Skeleton,
  StatusChip,
  Text,
  useTheme,
  useToast,
} from '@oja/ui';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Fragment, useRef } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';

import { useOrderGroup, type SellerOrder } from '@/api/orders';
import { OrderReviews } from '@/components/order-reviews';
import { OrderStatusDetails } from '@/components/order-status';
import { PickupDetails } from '@/components/pickup';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';

/**
 * A checkout ("Order detail"): a band saying where each shop's part is, then each shop's part
 * with its progress, anything missing and its refund, its items and its receipt rows. Once every
 * shop's part is over it reads as a receipt, with a plain header and no band ("Delivered order").
 */
export function OrderGroupScreen() {
  const theme = useTheme();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const group = useOrderGroup(userId, id);
  const { refreshing, refresh } = usePullToRefresh(async () => {
    const result = await group.refetch();
    if (result.isError && group.data) toast({ message: "Couldn't refresh this order", tone: 'problem' });
  });
  const scroll = useRef<ScrollViewInstance>(null);
  const receiptAt = useRef(0);

  const settled = group.data ? orderGroupSettled(group.data.orders) : false;
  const header = (title: string, receipt: boolean) => {
    const ink = settled ? theme.colors.ink : theme.colors.onBand;
    const receiptButton = (
      <ReceiptButton onBand={!settled} onPress={() => scroll.current?.scrollTo({ y: receiptAt.current, animated: true })} />
    );
    return (
      <Stack.Screen
        options={{
          title,
          headerStyle: { backgroundColor: settled ? theme.colors.bg : theme.colors.band },
          headerTintColor: ink,
          headerTitleStyle: { fontFamily: theme.type.titlePushed.fontFamily, color: ink },
          headerShadowVisible: false,
          // Plain text, not a glass pill: the catalogue's Receipt is a word in the header.
          unstable_headerRightItems: receipt
            ? () => [{ type: 'custom', element: receiptButton, hidesSharedBackground: true }]
            : undefined,
        }}
      />
    );
  };

  if (group.error && !group.data) {
    return (
      <>
        {header('Order', false)}
        <ErrorState title="Couldn't load this order" body="Check your connection and try again." error={group.error} onRetry={refresh} />
      </>
    );
  }
  if (!group.data) {
    return (
      <>
        {header('Order', false)}
        <OrderSkeleton />
      </>
    );
  }

  const { orders } = group.data;
  const currency = orders[0]?.currency_code ?? '';
  const paid = orders.reduce((sum, order) => sum + order.paid_total, 0);
  return (
    <>
      {header(orderNumber(group.data.display_id), true)}
      <ScrollView
        ref={scroll}
        // An order in progress has a tinted page (the catalogue's Order detail); a receipt is white.
        style={{ backgroundColor: settled ? theme.colors.bg : theme.colors.bgGrouped }}
        contentContainerStyle={{ paddingBottom: theme.space[8] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        {settled ? null : (
          <Band>
            <Text variant="titleNamed" tone="onBand">
              {orderGroupSummary(orders)}
            </Text>
          </Band>
        )}
        <View style={{ paddingHorizontal: theme.space[4] }}>
          <GroupList>
            {orders.map((order, index) => (
              <ShopOrder
                key={order.id}
                groupId={group.data.id}
                order={order}
                onReceiptLayout={index === 0 ? (y) => (receiptAt.current = y) : undefined}
              />
            ))}
            {orders.length > 1 ? (
              <Group>
                <SumRow label="Paid in all" value={formatMoney(paid, currency)} total />
                <Text variant="meta" tone="muted">
                  Each shop prepares and delivers its own part.
                </Text>
              </Group>
            ) : null}
          </GroupList>
        </View>
      </ScrollView>
    </>
  );
}

/** The header's Receipt button: scrolls down to what was paid. White on the band, accent on a plain header. */
function ReceiptButton({ onBand, onPress }: Readonly<{ onBand: boolean; onPress: () => void }>) {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityHint="Scrolls to what was paid"
      onPress={onPress}
      style={[styles.centre, { minHeight: theme.hitArea, paddingHorizontal: theme.space[2] }]}>
      <Text variant="meta" weight="bold" tone={onBand ? 'onBand' : 'accent'}>
        Receipt
      </Text>
    </PressableSurface>
  );
}

type ShopOrderProps = {
  groupId: string;
  order: SellerOrder;
  /** Where its receipt rows sit in the card's parent, for the header's Receipt. */
  onReceiptLayout?: (y: number) => void;
};

/** The text size (as a scale of the default) from which a shop's chip goes under its name. */
const LARGE_TEXT = 1.3;

/** One shop's part of the checkout. */
function ShopOrder({ groupId, order, onReceiptLayout }: Readonly<ShopOrderProps>) {
  const theme = useTheme();
  const status = orderCardStatus(order);
  const missing = missingItemsNote(order);
  const cardY = useRef(0);
  const changed = courierChangedNote(order.fulfilment.state, order.delivery);
  const chip = <StatusChip label={status.label} tone={status.tone} icon={status.icon} />;
  // At the largest text sizes the chip goes under the name, so the name keeps the width to wrap in.
  const stacked = useWindowDimensions().fontScale >= LARGE_TEXT;
  return (
    <View onLayout={(event) => (cardY.current = event.nativeEvent.layout.y)}>
      <Group>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <ShopMark name={order.seller.name} logoUrl={order.seller.logo} size="sm" />
          <View style={[styles.fill, { gap: stacked ? theme.space[1] : 0 }]}>
            <Text weight="extrabold" numberOfLines={2}>
              {order.seller.name}
            </Text>
            <ShopLine order={order} />
            {stacked ? chip : null}
          </View>
          {/* Wrapped so it centres on the name's line instead of keeping to the top. */}
          {stacked ? null : <View>{chip}</View>}
        </View>
        {changed ? (
          <Text variant="meta" tone="muted">
            {changed}
          </Text>
        ) : null}
        <Progress order={order} />
        <Tracking order={order} />
        {missing ? (
          <InlineNote>
            <Text variant="meta" weight="extrabold" style={{ color: theme.status.attention.foreground }}>
              {missing.missing}
            </Text>
            {missing.refund ? ` ${missing.refund}` : null}
          </InlineNote>
        ) : null}
        <OrderStatusDetails order={order} />
        <Collection groupId={groupId} order={order} />
        <View style={{ gap: theme.space[3] }}>
          {order.items.map((item) => (
            <ItemLine key={item.id} item={item} currency={order.currency_code} />
          ))}
        </View>
        <View
          onLayout={(event) => onReceiptLayout?.(cardY.current + event.nativeEvent.layout.y)}
          style={{ gap: theme.space[2], paddingTop: theme.space[1] }}>
          <SumRow label="Items" value={formatMoney(order.item_subtotal, order.currency_code)} />
          {order.pickup && !order.delivery_total ? null : (
            <SumRow label="Delivery" value={order.delivery_total ? formatMoney(order.delivery_total, order.currency_code) : 'Free'} />
          )}
          {order.discount_total ? (
            <SumRow label="Discount" value={`−${formatMoney(order.discount_total, order.currency_code)}`} />
          ) : null}
          <SumRow label="Paid" value={formatMoney(order.paid_total, order.currency_code)} total />
          {order.payment_reference ? (
            <Text variant="meta" tone="muted" selectable>
              {`Paystack ref ${order.payment_reference}`}
            </Text>
          ) : null}
        </View>
        {/* Order again (#86) sits beside the review button here once delivered or collected. */}
        <OrderReviews groupId={groupId} order={order} />
      </Group>
    </View>
  );
}

/** The buyer's time zone, for a delivered or collected order that doesn't carry its region's. */
const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Under the shop's name: when it opens, arrives, is to be collected by, or got there. */
function ShopLine({ order }: Readonly<{ order: SellerOrder }>) {
  const now = new Date();
  const { state, collect_by } = order.fulfilment;
  const line =
    (order.shop_opens && `Prepared when it opens ${openingLabel(order.shop_opens.at, now, order.shop_opens.time_zone)}`) ||
    orderArrival(state, order.delivery, now) ||
    (state === 'ready_for_pickup' && collect_by ? collectByLabel(collect_by.at, now, collect_by.time_zone) : null) ||
    reachedOnLabel(order.fulfilment, order.delivery?.time_zone ?? collect_by?.time_zone ?? DEVICE_TIME_ZONE);
  return line ? (
    <Text variant="meta" tone="muted">
      {line}
    </Text>
  ) : null;
}

/**
 * Where the shop's order has got, as four dots on a line: leaf up to where it is, a leaf ring
 * there, grey after. Hidden while it waits for the shop and once it is over; its chip says so.
 */
function Progress({ order }: Readonly<{ order: SellerOrder }>) {
  const theme = useTheme();
  const steps = orderProgress(order.fulfilment.state, order.pickup ? 'pickup' : 'delivery');
  if (!steps) return null;
  const at = steps.findIndex((step) => step.status === 'current');
  const dot = theme.space[3];
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${steps[at]?.label}, step ${at + 1} of ${steps.length}`}
      style={[styles.row, { paddingVertical: theme.space[1] }]}>
      {steps.map((step, index) => (
        <Fragment key={step.label}>
          {index > 0 ? (
            <View
              style={[
                styles.fill,
                { height: theme.line.input, backgroundColor: step.status === 'upcoming' ? theme.colors.line : theme.colors.leaf },
              ]}
            />
          ) : null}
          <View
            style={[
              { width: dot, height: dot, borderRadius: dot / 2, backgroundColor: theme.colors.line },
              step.status === 'done' && { backgroundColor: theme.colors.leaf },
              step.status === 'current' && {
                backgroundColor: theme.colors.raised,
                borderWidth: theme.line.ring,
                borderColor: theme.colors.leaf,
              },
            ]}
          />
        </Fragment>
      ))}
    </View>
  );
}

/** Once a courier is booked, a link to follow the parcel on the courier's tracking page (#25). */
function Tracking({ order }: Readonly<{ order: SellerOrder }>) {
  const { shipment } = order.fulfilment;
  return (
    <>
      {shipment && !shipment.cancelled ? (
        <ListRow
          title="Track your parcel"
          subtitle={[shipment.courier_name, `Waybill ${shipment.waybill}`].filter(Boolean).join(' · ')}
          trailing={<Text tone="muted">›</Text>}
          onPress={() => void Linking.openURL(shipment.tracking_url)}
        />
      ) : null}
    </>
  );
}

/**
 * A pickup order's collection (#12): where and when to collect it and, once it is Ready for
 * pickup, the way to its code (#80's screen). Once collected, or not collected in time, it says so.
 */
function Collection({ groupId, order }: Readonly<{ groupId: string; order: SellerOrder }>) {
  const theme = useTheme();
  const { pickup } = order;
  const { state } = order.fulfilment;
  // A rejected or cancelled order (#17) is never collected: its status says why, and its refund.
  if (!pickup || state === 'rejected' || state === 'cancelled' || state === 'collected') return null;
  if (state === 'not_collected') {
    return (
      <Text variant="meta" tone="muted">
        {PICKUP_HOLD_NOTICE}
      </Text>
    );
  }
  return (
    <View style={{ gap: theme.space[3] }}>
      {pickup.code ? (
        <Button
          label="Show pickup code"
          icon="scan"
          onPress={() => router.push({ pathname: '/pickup/[id]', params: { id: order.id, group: groupId } })}
        />
      ) : null}
      <PickupDetails place={pickup} note={pickup.code ? null : 'Your code appears here when the order is ready.'} />
    </View>
  );
}

function ItemLine({ item, currency }: Readonly<{ item: SellerOrder['items'][number]; currency: string }>) {
  const theme = useTheme();
  const thumb = theme.control.row;
  return (
    <View style={[styles.row, { gap: theme.space[3] }]}>
      <View style={{ width: thumb, height: thumb, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.productTile }}>
        {item.thumbnail ? <Image source={item.thumbnail} contentFit="contain" style={styles.fill} /> : null}
      </View>
      <View style={styles.fill}>
        <Text weight="bold" numberOfLines={2}>
          {orderLineName(item)}
        </Text>
        <Text variant="meta" tone="muted">
          {item.quantity ? `× ${item.quantity}` : 'Not available'}
        </Text>
      </View>
      <Text weight="extrabold" tabular>
        {formatMoney(item.total, currency)}
      </Text>
    </View>
  );
}

function SumRow({ label, value, total }: Readonly<{ label: string; value: string; total?: boolean }>) {
  const theme = useTheme();
  return (
    <View
      accessible
      style={[
        styles.spread,
        total && { paddingTop: theme.space[2] },
      ]}>
      <Text variant={total ? 'strong' : 'body'} tone={total ? 'default' : 'muted'}>
        {label}
      </Text>
      {total ? (
        <Text variant="heading" tabular>
          {value}
        </Text>
      ) : (
        <Text weight="bold" tabular>
          {value}
        </Text>
      )}
    </View>
  );
}

/** Loading: the band and a shop's part in outline. */
function OrderSkeleton() {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel="Loading this order" style={[styles.fill, { backgroundColor: theme.colors.bgGrouped }]}>
      <Band>
        <View style={{ height: theme.type.titleNamed.lineHeight }} />
      </Band>
      <View style={{ paddingHorizontal: theme.space[4] }}>
        <Group>
          <View style={[styles.row, { gap: theme.space[2] }]}>
            <Skeleton width={theme.shopMark.sm.size} height={theme.shopMark.sm.size} radius="md" />
            <View style={[styles.fill, { gap: theme.space[1] }]}>
              <Skeleton width="60%" height={theme.type.body.lineHeight} radius="pill" />
              <Skeleton width="40%" height={theme.type.meta.lineHeight} radius="pill" />
            </View>
          </View>
          {[0, 1].map((key) => (
            <View key={key} style={[styles.row, { gap: theme.space[3] }]}>
              <Skeleton width={theme.control.row} height={theme.control.row} radius="md" />
              <Skeleton width="50%" height={theme.type.body.lineHeight} radius="pill" />
            </View>
          ))}
          <Skeleton height={theme.type.heading.lineHeight} radius="pill" />
        </Group>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
