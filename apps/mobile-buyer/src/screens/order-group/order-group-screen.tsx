import { useAuth } from '@clerk/expo';
import { formatMoney, historyEntries } from '@oja/domain';
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
    return <ErrorState title="Couldn't load this order" message={group.error.message} onRetry={refresh} />;
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
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={{ gap: theme.space.xs }}>
          <Text tone="secondary">{`Ordered ${orderedAt(group.data.created_at)}`}</Text>
          {entry?.kind === 'group' ? (
            <Text tone="secondary">Each shop prepares and delivers its own order.</Text>
          ) : null}
        </View>
        {group.data.orders.map((order) => (
          <ShopOrder key={order.id} groupId={group.data.id} order={order} />
        ))}
        {entry ? (
          <View style={[styles.spread, { paddingTop: theme.space.sm }]}>
            <Text variant="label">Paid</Text>
            <Text variant="label">{formatMoney(entry.paid_total, currency)}</Text>
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
        gap: theme.space.sm,
        paddingTop: theme.space.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
      }}>
      <View style={styles.spread}>
        <Text variant="heading">{order.seller.name}</Text>
        <Text tone="secondary">#{order.display_id}</Text>
      </View>
      <OrderStatusDetails order={order} />
      {order.pickup ? <Collection order={order} pickup={order.pickup} /> : null}
      <Tracking order={order} />
      {order.items.map((item) => (
        <View key={item.id} style={[styles.item, { gap: theme.space.md }]}>
          {item.thumbnail ? (
            <Image
              source={item.thumbnail}
              contentFit="contain"
              style={[styles.thumb, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm }]}
            />
          ) : null}
          <View style={styles.fill}>
            <Text numberOfLines={2}>{item.product_title ?? 'Item'}</Text>
            <Text variant="caption" tone="secondary">
              {[item.variant_title, quantityLabel(item)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text>{formatMoney(item.total, order.currency_code)}</Text>
        </View>
      ))}
      <View style={styles.spread}>
        <Text tone="secondary">{order.pickup ? 'Paid to this shop' : 'Paid to this shop, with delivery'}</Text>
        <Text variant="label">{formatMoney(order.paid_total, order.currency_code)}</Text>
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
          trailing={<Text tone="secondary">›</Text>}
          onPress={() => void Linking.openURL(shipment.tracking_url)}
        />
      ) : null}
      {timeline.length ? <Timeline steps={timeline} /> : null}
    </>
  );
}

/**
 * A pickup order's collection (#12): where and when to collect it, and once it is Ready for
 * pickup the code to show at the counter, with its QR code. Whoever shows the code collects it.
 */
function Collection({ order, pickup }: Readonly<{ order: SellerOrder; pickup: NonNullable<SellerOrder['pickup']> }>) {
  const theme = useTheme();
  const collected = order.fulfilment.state === 'collected';
  return (
    <View style={{ gap: theme.space.md, padding: theme.space.md, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface }}>
      <Text variant="label">{collected ? 'Collected in store' : 'Collect in store'}</Text>
      {pickup.code ? (
        <>
          <PickupCode code={pickup.code} />
          <Text tone="secondary">Show this code at the counter. Whoever has it can collect the whole order.</Text>
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
