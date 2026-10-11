import { formatMoney } from '@oja/domain';
import { Button, EmptyState, ErrorState, ListRow, LoadingState, useTheme } from '@oja/ui';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { orderValue, useOrders } from '@/api/orders';
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
  const orders = useOrders(sellerId);
  const now = useNow();
  // Only a pull shows the spinner; background refetches stay silent.
  const [pulling, setPulling] = useState(false);
  const [readyOnly, setReadyOnly] = useState(false);
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
    // Orders waiting at the counter for their buyers (#12).
    const ready = orders.data.filter((o) => o.fulfilment.state === 'ready_for_pickup');
    const shown = readyOnly ? ready : orders.data;

    return (
      <FlatList
        data={shown}
        keyExtractor={(o) => o.id}
        contentContainerStyle={shown.length === 0 ? styles.emptyList : { paddingHorizontal: theme.space.md }}
        ListHeaderComponent={
          ready.length || readyOnly ? (
            <View style={[styles.filters, { gap: theme.space.sm, paddingVertical: theme.space.sm }]}>
              <Button label="All orders" variant={readyOnly ? 'secondary' : 'primary'} onPress={() => setReadyOnly(false)} />
              <Button
                label={`Ready for pickup (${ready.length})`}
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
            subtitle={itemsSummary(item.items)}
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
          headerRight: () => <Button label="Settings" variant="link" onPress={() => router.push('/settings')} />,
        }}
      />
      {content()}
    </>
  );
}

/** Quick-add (#38): scan a product the shop stocks but doesn't sell online yet. */
function AddProductButton() {
  const router = useRouter();
  return <Button label="Add product" variant="link" onPress={() => router.push('/quick-add')} />;
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap' },
});
