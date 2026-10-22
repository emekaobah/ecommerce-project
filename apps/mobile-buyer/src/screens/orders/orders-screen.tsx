import { useAuth } from '@clerk/expo';
import { formatMoney, historyEntries, type HistoryEntry } from '@oja/domain';
import { EmptyState, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOrderHistory, type OrderGroup, type SellerOrder } from '@/api/orders';
import { OrderStatusChips, orderedAt } from '@/components/order-status';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { openOrderGroup } from '@/navigation';

/**
 * Orders need a signed-in buyer (ADR 0001). As a tab it can't be a protected route without
 * hiding the tab, so a guest sees the way into the sign-in modal instead.
 */
export function OrdersScreen() {
  const theme = useTheme();
  const { isSignedIn, userId } = useAuth();
  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      {isSignedIn ? (
        <>
          <Text variant="titleRoot" style={{ marginVertical: theme.space[4], paddingHorizontal: theme.space[4] }}>
            Orders
          </Text>
          <OrderHistory userId={userId} />
        </>
      ) : (
        <SignInPrompt title="Your orders" message="Sign in to see and track your orders." />
      )}
    </SafeAreaView>
  );
}

function OrderHistory({ userId }: Readonly<{ userId: string | null | undefined }>) {
  const theme = useTheme();
  const history = useOrderHistory(userId);
  const { refreshing, refresh } = usePullToRefresh(() => history.refetch());

  if (history.error && !history.data) {
    return <ErrorState title="Couldn't load your orders" body="Check your connection and try again." error={history.error} onRetry={refresh} />;
  }
  if (!history.data) return <LoadingState />;

  const entries = historyEntries<SellerOrder, OrderGroup>(history.data);
  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => entry.group.id}
      contentContainerStyle={[{ paddingHorizontal: theme.space[4] }, !entries.length && styles.grow]}
      refreshing={refreshing}
      onRefresh={refresh}
      ListEmptyComponent={
        <EmptyState
          title="No orders yet"
          body="When you buy something, it shows up here."
          action={{ label: 'Start shopping', onPress: () => router.navigate('/') }}
        />
      }
      renderItem={({ item }) => <HistoryRow entry={item} />}
    />
  );
}

/** A checkout: one shop's order on its own, or the shops' orders it was split into. */
function HistoryRow({ entry }: Readonly<{ entry: HistoryEntry<OrderGroup, SellerOrder> }>) {
  const theme = useTheme();
  const { group } = entry;
  const orders = entry.kind === 'order' ? [entry.order] : group.orders;
  const currency = orders[0]?.currency_code ?? '';
  const itemCount = orders.reduce((sum, o) => sum + o.items.reduce((n, i) => n + i.quantity, 0), 0);
  const title = entry.kind === 'order' ? entry.order.seller.name : `${group.orders.length} shops`;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openOrderGroup(group)}
      style={({ pressed }) => [
        {
          paddingVertical: theme.space[4],
          gap: theme.space[2],
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.line,
        },
        pressed && { backgroundColor: theme.colors.tile },
      ]}>
      <View style={[styles.spread, { gap: theme.space[4] }]}>
        <View style={styles.fill}>
          <Text variant="strong" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="meta" tone="muted">
            {`${orderedAt(group.created_at)} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
          </Text>
        </View>
        <Text variant="strong">{formatMoney(entry.paid_total, currency)}</Text>
      </View>
      {orders.map((order) => (
        <View key={order.id} style={{ gap: theme.space[1] }}>
          {entry.kind === 'group' ? (
            <Text variant="meta" tone="muted">
              {order.seller.name}
            </Text>
          ) : null}
          <OrderStatusChips order={order} />
        </View>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  grow: { flexGrow: 1 },
  fill: { flex: 1 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
});
