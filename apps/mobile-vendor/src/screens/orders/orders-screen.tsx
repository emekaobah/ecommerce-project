import { collectByLabel, formatMoney, ORDER_STAGES, vendorShopState, type OrderStage, type ShopHours } from '@oja/domain';
import {
  Button,
  Divider,
  EmptyState,
  ErrorState,
  haptics,
  Icon,
  type IconName,
  PressableSurface,
  Skeleton,
  StageTiles,
  Text,
  useTheme,
  useToast,
} from '@oja/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { orderValue, useAcceptOrder, useStageCounts, useStageOrders, type StageOrder } from '@/api/orders';
import { useCurrentSeller } from '@/api/sellers';
import { useShopHours } from '@/api/shop-hours';
import { FulfilmentChip } from '@/orders/fulfilment-chip';
import { itemsSummary } from '@/orders/items';
import { shopHoursOf } from '@/orders/shop-state';
import { useNow } from '@/orders/use-now';
import { useSession } from '@/session/session-store';

const STAGE_LABELS: Record<OrderStage, string> = { new: 'New', picking: 'Picking', ready: 'Ready', out: 'Out' };

/** What each stage's list says when it is empty. */
const EMPTY: Record<OrderStage, { title: string; body: string; icon: IconName }> = {
  new: { title: 'No orders yet', body: 'New orders show up here.', icon: 'bell' },
  picking: { title: 'Nothing to pick', body: 'Orders you accept show up here while you pick and pack them.', icon: 'box' },
  ready: { title: 'Nothing ready', body: 'Orders ready for their buyers to collect show up here.', icon: 'store' },
  out: { title: 'Nothing out', body: 'Orders on their way with a courier show up here.', icon: 'truck' },
};

/**
 * The shop's orders by stage (#69): the shop's open state in the header, the New, Picking, Ready
 * and Out tiles with the server's counts, and every order in the stage picked, newest first.
 */
export function OrdersScreen() {
  const theme = useTheme();
  const sellerId = useSession()?.sellerId;
  const [stage, setStage] = useState<OrderStage>('new');
  const counts = useStageCounts(sellerId);
  const orders = useStageOrders(sellerId, stage);
  const hours = shopHoursOf(useShopHours(sellerId).data);
  const now = useNow();
  // Only a pull shows the spinner; background refetches stay silent.
  const [pulling, setPulling] = useState(false);
  const refresh = () => {
    setPulling(true);
    void Promise.all([orders.refetch(), counts.refetch()]).finally(() => setPulling(false));
  };

  const content = () => {
    // A failed refresh keeps the list already on screen.
    if (orders.error && !orders.data) {
      return (
        <ErrorState
          title="Couldn't load orders"
          body="Check your connection and try again. Nothing about your orders has changed."
          error={orders.error}
          onRetry={refresh}
        />
      );
    }
    if (!orders.data) return <CardsLoading />;
    return (
      <FlatList
        data={orders.data}
        keyExtractor={(o) => o.id}
        contentContainerStyle={orders.data.length === 0 ? styles.fill : { paddingHorizontal: theme.space[4], paddingBottom: theme.space[6] }}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={<EmptyState {...EMPTY[stage]} />}
        refreshing={pulling}
        onRefresh={refresh}
        onEndReached={() => {
          if (orders.hasNextPage && !orders.isFetchingNextPage) void orders.fetchNextPage();
        }}
        renderItem={({ item }) => <OrderCard order={item} now={now} hours={hours} />}
      />
    );
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.grow, { backgroundColor: theme.colors.bg }]}>
      <ShopHeader sellerId={sellerId} hours={hours} now={now} />
      <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[4] }}>
        <StageTiles
          stages={ORDER_STAGES.map((key) => ({ key, label: STAGE_LABELS[key], count: counts.data?.[key] ?? null }))}
          selected={stage}
          onSelect={setStage}
        />
      </View>
      {content()}
    </SafeAreaView>
  );
}

/**
 * The shop's name and open state, then today's date with when it closes or opens, beside
 * Quick-add and Settings.
 * The name comes from the cached shop list, so it shows at once.
 */
function ShopHeader({ sellerId, hours, now }: Readonly<{ sellerId: string | undefined; hours: ShopHours | null; now: Date }>) {
  const theme = useTheme();
  const router = useRouter();
  const seller = useCurrentSeller(sellerId);
  const state = hours ? vendorShopState(hours, now) : null;
  const pill = theme.status[state?.chip.tone ?? 'neutral'];

  return (
    <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[2] }}>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Text variant="titleNamed" numberOfLines={2} style={styles.name}>
          {seller.data?.name ?? ''}
        </Text>
        {state ? (
          <View
            accessible
            accessibilityLabel={state.chip.label}
            style={[
              styles.pill,
              {
                gap: theme.space[2],
                paddingVertical: theme.space[1],
                paddingHorizontal: theme.space[3],
                borderRadius: theme.radius.pill,
                backgroundColor: pill.background,
              },
            ]}>
            <View style={{ width: theme.space[2], height: theme.space[2], borderRadius: theme.radius.pill, backgroundColor: pill.foreground }} />
            <Text variant="meta" weight="extrabold" style={{ color: pill.foreground }}>
              {state.chip.label}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.row, styles.centred, { gap: theme.space[2] }]}>
        <Text variant="meta" tone="muted" style={styles.name}>
          {state?.line ?? ''}
        </Text>
        {/* Quick-add (#38): scan a product the shop stocks but doesn't sell online yet. */}
        <HeaderButton icon="scan" label="Add product" onPress={() => router.push('/quick-add')} />
        <HeaderButton icon="user" label="Settings" onPress={() => router.push('/settings')} />
      </View>
    </View>
  );
}

function HeaderButton({ icon, label, onPress }: Readonly<{ icon: IconName; label: string; onPress: () => void }>) {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.iconButton, { width: theme.hitArea, height: theme.hitArea, borderRadius: theme.radius.pill }]}>
      <Icon name={icon} />
    </PressableSurface>
  );
}

/**
 * One order: its number and what the buyer paid, its accept clock or state, and delivery or
 * pickup with its lines. A new order has Details and Accept; any other opens on a tap.
 */
function OrderCard({ order, now, hours }: Readonly<{ order: StageOrder; now: Date; hours: ShopHours | null }>) {
  const theme = useTheme();
  const router = useRouter();
  const { fulfilment } = order;
  const open = () => router.push({ pathname: '/orders/[id]', params: { id: order.id } });
  const method = fulfilment.method === 'pickup' ? 'Pickup' : 'Delivery';
  const hold = fulfilment.collect_by ? collectByLabel(fulfilment.collect_by.at, now, fulfilment.collect_by.time_zone) : null;
  // A flat row between dividers, with no fill or outline: the time chip says when it's urgent.
  const card = { gap: theme.space[2], paddingTop: theme.space[5], paddingBottom: theme.space[6] };

  const body = (
    <>
      <View style={[styles.cardTop, { gap: theme.space[2] }]}>
        {/* Kept whole (no-break spaces): at the largest text the chip wraps under it instead. */}
        <Text variant="heading" tabular style={styles.shrink}>
          {`#${order.display_id} · ${formatMoney(orderValue(order), order.currency_code)}`.replaceAll(' ', '\u00a0')}
        </Text>
        <FulfilmentChip fulfilment={fulfilment} now={now} hours={hours} />
      </View>
      <Text variant="meta" tone="muted">
        {[method, itemsSummary(order.items), hold].filter(Boolean).join(' · ')}
      </Text>
    </>
  );

  if (fulfilment.state !== 'new') {
    return (
      <PressableSurface accessibilityRole="button" onPress={open} style={card}>
        {body}
      </PressableSurface>
    );
  }
  return (
    <View style={card}>
      {body}
      <View style={[styles.row, { gap: theme.space[2], marginTop: theme.space[2] }]}>
        <Button label="Details" variant="secondary" size="row" onPress={open} style={styles.grow} />
        <AcceptButton orderId={order.id} displayId={order.display_id} />
      </View>
    </View>
  );
}

/** Accepts the order from the list: accepting starts picking, so it moves to Picking. */
function AcceptButton({ orderId, displayId }: Readonly<{ orderId: string; displayId: number }>) {
  const accept = useAcceptOrder(orderId);
  const toast = useToast();
  return (
    <Button
      label="Accept"
      size="row"
      style={styles.grow}
      loading={accept.isPending}
      onPress={() =>
        accept.mutate(undefined, {
          onSuccess: () => {
            haptics.success();
            toast({ message: `Order #${displayId} accepted. It's in Picking.`, tone: 'done' });
          },
          // The list refreshes either way: someone, or the deadline, may have moved it on meanwhile.
          onError: () => toast({ message: `Couldn't accept order #${displayId}. Open it to see where it is.`, tone: 'problem' }),
        })
      }
    />
  );
}

/** Two order rows in their shape while the stage's orders load. */
function CardsLoading() {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel="Loading orders" style={{ paddingHorizontal: theme.space[4] }}>
      {[0, 1].map((key) => (
        <View
          key={key}
          style={{
            gap: theme.space[2],
            paddingTop: theme.space[5],
            paddingBottom: theme.space[6],
            borderBottomWidth: theme.line.divider,
            borderBottomColor: theme.colors.divider,
          }}>
          <View style={styles.cardTop}>
            <Skeleton width="45%" height={theme.type.heading.fontSize} />
            <Skeleton width={theme.space[12] + theme.space[6]} height={theme.space[6]} radius="pill" />
          </View>
          <Skeleton width="80%" height={theme.type.meta.fontSize} />
          <View style={[styles.row, { gap: theme.space[2], marginTop: theme.space[2] }]}>
            <Skeleton height={theme.control.row} radius="md" style={styles.grow} />
            <Skeleton height={theme.control.row} radius="md" style={styles.grow} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  fill: { flexGrow: 1 },
  row: { flexDirection: 'row' },
  name: { flex: 1, minWidth: 0 },
  centred: { alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, alignSelf: 'flex-start' },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
  cardTop: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' },
  shrink: { flexShrink: 1 },
});
