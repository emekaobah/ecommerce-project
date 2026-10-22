import { useAuth } from '@clerk/expo';
import {
  collectByLabel,
  courierChangedNote,
  formatMoney,
  historyEntries,
  openingLabel,
  orderArrival,
  PICKUP_HOLD_NOTICE,
  preparedWhenOpen,
} from '@oja/domain';
import { ErrorState, ListRow, LoadingState, Text, Timeline, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { useOrderGroup, type OrderGroup, type SellerOrder } from '@/api/orders';
import { OrderReviews } from '@/components/order-reviews';
import { OrderStatusDetails, orderedAt } from '@/components/order-status';
import { PickupCode, PickupDetails } from '@/components/pickup';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';

/** A checkout: each shop's order of it, with its items, where it is, and the courier's tracking. */
export function OrderGroupScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const group = useOrderGroup(userId, id);
  const { refreshing, refresh } = usePullToRefresh(() => group.refetch());

  if (group.error && !group.data) {
    return <ErrorState title="Couldn't load this order" body="Check your connection and try again." error={group.error} onRetry={refresh} />;
  }
  if (!group.data) return <LoadingState />;

  const [entry] = historyEntries<SellerOrder, OrderGroup>([group.data]);
  const currency = group.data.orders[0]?.currency_code ?? '';
  // A group of one order is that order (#65): no group level around it.
  const title = entry?.kind === 'order' ? entry.order.seller.name : `Order #${group.data.display_id}`;
  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView
        style={{ backgroundColor: theme.colors.bg }}
        contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={{ gap: theme.space[1] }}>
          <Text tone="muted">{`Ordered ${orderedAt(group.data.created_at)}`}</Text>
          {entry?.kind === 'group' ? (
            <Text tone="muted">Each shop prepares and delivers its own order.</Text>
          ) : null}
        </View>
        {group.data.orders.map((order) => (
          <ShopOrder key={order.id} groupId={group.data.id} order={order} />
        ))}
        {entry ? (
          <View style={[styles.spread, { paddingTop: theme.space[2] }]}>
            <Text variant="strong">Paid</Text>
            <Text variant="strong">{formatMoney(entry.paid_total, currency)}</Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function ShopOrder({ groupId, order }: Readonly<{ groupId: string; order: SellerOrder }>) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.space[2],
        paddingTop: theme.space[4],
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.line,
      }}>
      <View style={styles.spread}>
        <Text variant="heading">{order.seller.name}</Text>
        <Text tone="muted">#{order.display_id}</Text>
      </View>
      <OrderStatusDetails order={order} />
      <Arrival order={order} />
      {order.pickup ? <Collection order={order} pickup={order.pickup} /> : null}
      <Tracking order={order} />
      {order.items.map((item) => (
        <View key={item.id} style={[styles.item, { gap: theme.space[4] }]}>
          {item.thumbnail ? (
            <Image
              source={item.thumbnail}
              contentFit="contain"
              style={[styles.thumb, { backgroundColor: theme.colors.productTile, borderRadius: theme.radius.sm }]}
            />
          ) : null}
          <View style={styles.fill}>
            <Text numberOfLines={2}>{item.product_title ?? 'Item'}</Text>
            <Text variant="meta" tone="muted">
              {[item.variant_title, quantityLabel(item)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text>{formatMoney(item.total, order.currency_code)}</Text>
        </View>
      ))}
      <View style={styles.spread}>
        <Text tone="muted">{order.pickup ? 'Paid to this shop' : 'Paid to this shop, with delivery'}</Text>
        <Text variant="strong">{formatMoney(order.paid_total, order.currency_code)}</Text>
      </View>
      <OrderReviews groupId={groupId} order={order} />
    </View>
  );
}

/**
 * Where the shop's order has got, step by step, and once a courier is booked a link to follow
 * the parcel on the courier's tracking page (#25).
 */
function Tracking({ order }: Readonly<{ order: SellerOrder }>) {
  const { timeline, shipment } = order.fulfilment;
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
      {timeline.length ? <Timeline steps={timeline} /> : null}
    </>
  );
}

/**
 * When a delivered order arrives and with which courier, as checkout quoted it or, once booked,
 * as the booked courier did, and that it changed when another than the buyer's was booked (#19).
 * While its closed shop hasn't opened yet, that it is prepared then (ADR 0004): the estimate
 * counts from that opening.
 */
function Arrival({ order }: Readonly<{ order: SellerOrder }>) {
  const theme = useTheme();
  const now = new Date();
  const arrives = orderArrival(order.fulfilment.state, order.delivery, now);
  const opens = order.shop_opens;
  const changed = courierChangedNote(order.fulfilment.state, order.delivery);
  if (!arrives && !opens) return null;
  return (
    <View style={{ gap: theme.space[1] }}>
      {opens ? (
        <Text tone="muted">
          {preparedWhenOpen({ name: order.seller.name, opens: openingLabel(opens.at, now, opens.time_zone) })}
        </Text>
      ) : null}
      {arrives ? <Text variant="strong">{arrives}</Text> : null}
      {changed ? <Text tone="muted">{changed}</Text> : null}
    </View>
  );
}

/**
 * A pickup order's collection (#12): where and when to collect it, and once it is Ready for
 * pickup the code to show at the counter, with its QR code, and when to collect it by (#32).
 * Whoever shows the code collects it. Once collected, or not collected in time, it says so.
 */
function Collection({ order, pickup }: Readonly<{ order: SellerOrder; pickup: NonNullable<SellerOrder['pickup']> }>) {
  const theme = useTheme();
  const { state, collect_by } = order.fulfilment;
  // A rejected or cancelled order (#17) is never collected: its status says why, and its refund.
  if (state === 'rejected' || state === 'cancelled') return null;
  if (state === 'not_collected') {
    return (
      <View style={{ gap: theme.space[4], padding: theme.space[4], borderRadius: theme.radius.md, backgroundColor: theme.colors.tile }}>
        <Text variant="strong">Not collected in time</Text>
        <Text tone="muted">{PICKUP_HOLD_NOTICE}</Text>
      </View>
    );
  }
  const collected = state === 'collected';
  return (
    <View style={{ gap: theme.space[4], padding: theme.space[4], borderRadius: theme.radius.md, backgroundColor: theme.colors.tile }}>
      <Text variant="strong">{collected ? 'Collected in store' : 'Collect in store'}</Text>
      {pickup.code ? (
        <>
          <PickupCode code={pickup.code} />
          {collect_by ? <Text variant="strong">{collectByLabel(collect_by.at, new Date(), collect_by.time_zone)}</Text> : null}
          <Text tone="muted">Show this code at the counter. Whoever has it can collect the whole order.</Text>
        </>
      ) : null}
      {collected ? null : <PickupDetails place={pickup} note={pickup.code ? null : 'Your code appears here when the order is ready.'} />}
    </View>
  );
}

/** How many are coming, and how many the shop didn't have (#22); the order's refund chip says where that money is. */
function quantityLabel(item: SellerOrder['items'][number]) {
  if (!item.unavailable_quantity) return `Qty ${item.quantity}`;
  if (!item.quantity) return 'Unavailable';
  return `Qty ${item.quantity} · ${item.unavailable_quantity} unavailable`;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  item: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 48, height: 48 },
});
