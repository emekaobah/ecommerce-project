import { useAuth } from '@clerk/expo';
import {
  collectByLabel,
  courierChangedNote,
  formatMoney,
  missingItemsNote,
  openingLabel,
  orderArrival,
  orderCardStatus,
  orderGroupSummary,
  orderNumber,
  PICKUP_HOLD_NOTICE,
  reachedOnLabel,
} from '@oja/domain';
import { Band, Button, ErrorState, InlineNote, ListRow, PressableSurface, ShopMark, Skeleton, StatusChip, Text, Timeline, useTheme, useToast } from '@oja/ui';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, type ReactNode } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { useOrderGroup, type SellerOrder } from '@/api/orders';
import { OrderReviews } from '@/components/order-reviews';
import { OrderStatusDetails } from '@/components/order-status';
import { PickupDetails } from '@/components/pickup';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';

/**
 * A checkout ("Order detail"): a band saying where each shop's part is, then a card per shop
 * with its progress, anything missing and its refund, its items and its receipt rows.
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

  const renderReceipt = () => (
    <ReceiptButton onPress={() => scroll.current?.scrollTo({ y: receiptAt.current, animated: true })} />
  );
  const header = (title: string, receipt: boolean) => (
    <Stack.Screen
      options={{
        title,
        headerStyle: { backgroundColor: theme.colors.band },
        headerTintColor: theme.colors.onBand,
        headerTitleStyle: { fontFamily: theme.type.titlePushed.fontFamily, color: theme.colors.onBand },
        headerShadowVisible: false,
        headerRight: receipt ? renderReceipt : undefined,
      }}
    />
  );

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
        style={{ backgroundColor: theme.colors.bgGrouped }}
        contentContainerStyle={{ paddingBottom: theme.space[8] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <Band>
          <Text variant="titleNamed" tone="onBand">
            {orderGroupSummary(orders)}
          </Text>
        </Band>
        <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
          {orders.map((order, index) => (
            <ShopOrder
              key={order.id}
              groupId={group.data.id}
              order={order}
              onReceiptLayout={index === 0 ? (y) => (receiptAt.current = y) : undefined}
            />
          ))}
          {orders.length > 1 ? (
            <Card>
              <SumRow label="Paid in all" value={formatMoney(paid, currency)} total />
              <Text variant="meta" tone="muted">
                Each shop prepares and delivers its own part.
              </Text>
            </Card>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

/** The header's Receipt button: scrolls down to what was paid. */
function ReceiptButton({ onPress }: Readonly<{ onPress: () => void }>) {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityHint="Scrolls to what was paid"
      onPress={onPress}
      style={[styles.centre, { minHeight: theme.hitArea, paddingHorizontal: theme.space[2] }]}>
      <Text weight="bold" tone="onBand">
        Receipt
      </Text>
    </PressableSurface>
  );
}

function Card({ children }: Readonly<{ children: ReactNode }>) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.lg,
        borderWidth: theme.line.divider,
        borderColor: theme.colors.line,
        backgroundColor: theme.colors.raised,
      }}>
      {children}
    </View>
  );
}

type ShopOrderProps = {
  groupId: string;
  order: SellerOrder;
  /** Where its receipt rows sit in the card's parent, for the header's Receipt. */
  onReceiptLayout?: (y: number) => void;
};

/** One shop's part of the checkout. */
function ShopOrder({ groupId, order, onReceiptLayout }: Readonly<ShopOrderProps>) {
  const theme = useTheme();
  const status = orderCardStatus(order);
  const missing = missingItemsNote(order);
  const cardY = useRef(0);
  const changed = courierChangedNote(order.fulfilment.state, order.delivery);
  return (
    <View onLayout={(event) => (cardY.current = event.nativeEvent.layout.y)}>
      <Card>
        <View style={[styles.row, { gap: theme.space[2] }]}>
          <ShopMark name={order.seller.name} logoUrl={order.seller.logo} size="sm" />
          <View style={styles.fill}>
            <Text weight="bold" numberOfLines={2}>
              {order.seller.name}
            </Text>
            <ShopLine order={order} />
          </View>
          <StatusChip label={status.label} tone={status.tone} icon={status.icon} />
        </View>
        {changed ? (
          <Text variant="meta" tone="muted">
            {changed}
          </Text>
        ) : null}
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
            <SumRow label="Delivery" value={formatMoney(order.delivery_total, order.currency_code)} />
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
      </Card>
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
 * Where the shop's order has got, step by step, and once a courier is booked a link to follow
 * the parcel on the courier's tracking page (#25).
 */
function Tracking({ order }: Readonly<{ order: SellerOrder }>) {
  const { timeline, shipment } = order.fulfilment;
  return (
    <>
      {timeline.length ? <Timeline steps={timeline} /> : null}
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
          {[item.product_title ?? 'Item', item.variant_title].filter(Boolean).join(' · ')}
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
        total && { borderTopWidth: theme.line.divider, borderTopColor: theme.colors.line, paddingTop: theme.space[2] },
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

/** Loading: the band and a shop card in outline. */
function OrderSkeleton() {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel="Loading this order" style={[styles.fill, { backgroundColor: theme.colors.bgGrouped }]}>
      <Band>
        <View style={{ height: theme.type.titleNamed.lineHeight }} />
      </Band>
      <View style={{ padding: theme.space[4] }}>
        <Card>
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
        </Card>
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
