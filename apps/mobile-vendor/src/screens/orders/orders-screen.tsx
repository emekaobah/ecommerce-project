import { collectByLabel, formatMoney } from '@oja/domain';
import { Button, EmptyState, ErrorState, ListRow, LoadingState, useTheme } from '@oja/ui';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { orderValue, useOrders, useReadyOrders, type OrderFulfilment } from '@/api/orders';
import { useCurrentSeller } from '@/api/sellers';
import { FulfilmentChip } from '@/orders/fulfilment-chip';
import { itemsSummary } from '@/orders/items';
import { useNow } from '@/orders/use-now';
import { useSession } from '@/session/session-store';

export function OrdersScreen() {
  const theme = useTheme();
  const router = useRouter();
  const sellerId = useSession()?.sellerId;
  const seller = useCurrentSeller(sellerId);
  const [readyOnly, setReadyOnly] = useState(false);
  const recent = useOrders(sellerId);
  // Orders waiting at the counter for their buyers (#12), found by the server however old.
  const ready = useReadyOrders(sellerId);
  const orders = readyOnly ? ready : recent;
  const now = useNow();
  // Only a pull shows the spinner; background refetches stay silent.
  const [pulling, setPulling] = useState(false);
  const refresh = () => {
    setPulling(true);
    void orders.refetch().finally(() => setPulling(false));
  };

  const content = () => {
    // A failed refresh keeps the list already on screen.
    if (orders.error && !orders.data) {
      return <ErrorState title="Couldn't load orders" message={orders.error.message} onRetry={refresh} />;
    }
    if (!orders.data) return <LoadingState />;
    const readyCount = ready.data?.length ?? 0;
    const shown = orders.data;

    return (
      <FlatList
        data={shown}
        keyExtractor={(o) => o.id}
        contentContainerStyle={shown.length === 0 ? styles.emptyList : { paddingHorizontal: theme.space.md }}
        ListHeaderComponent={
          readyCount || readyOnly ? (
            <View style={[styles.filters, { gap: theme.space.sm, paddingVertical: theme.space.sm }]}>
              <Button label="All orders" variant={readyOnly ? 'secondary' : 'primary'} onPress={() => setReadyOnly(false)} />
              <Button
                label={`Ready for pickup (${readyCount})`}
                variant={readyOnly ? 'primary' : 'secondary'}
                onPress={() => setReadyOnly(true)}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          readyOnly ? (
            <EmptyState title="Nothing waiting" message="Orders ready for their buyers to collect show up here." />
          ) : (
            <EmptyState title="No orders yet" message="New orders show up here." />
          )
        }
        refreshing={pulling}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <ListRow
            title={`#${item.display_id} · ${formatMoney(orderValue(item), item.currency_code)}`}
            subtitle={[itemsSummary(item.items), holdLabel(item.fulfilment, now)].filter(Boolean).join(' · ')}
            trailing={<FulfilmentChip fulfilment={item.fulfilment} now={now} />}
            onPress={() => router.push({ pathname: '/orders/[id]', params: { id: item.id } })}
          />
        )}
      />
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: seller.data?.name ?? 'Orders',
          headerLeft: AddProductButton,
          headerRight: SettingsButton,
        }}
      />
      {content()}
    </>
  );
}

/** When a pickup order waiting at the counter must be collected by (#32); null for any other. */
function holdLabel(fulfilment: OrderFulfilment, now: Date) {
  const collectBy = fulfilment.collect_by;
  return collectBy ? collectByLabel(collectBy.at, now, collectBy.time_zone) : null;
}

/** Quick-add (#38): scan a product the shop stocks but doesn't sell online yet. */
function AddProductButton() {
  const router = useRouter();
  return <Button label="Add product" variant="link" onPress={() => router.push('/quick-add')} />;
}

function SettingsButton() {
  const router = useRouter();
  return <Button label="Settings" variant="link" onPress={() => router.push('/settings')} />;
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap' },
});
