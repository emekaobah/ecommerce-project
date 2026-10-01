import { formatMoney } from '@oja/domain';
import { Button, EmptyState, ErrorState, ListRow, LoadingState, useTheme } from '@oja/ui';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { useOrders } from '@/api/orders';
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

    return (
      <FlatList
        data={orders.data}
        keyExtractor={(o) => o.id}
        contentContainerStyle={orders.data.length === 0 ? styles.emptyList : { paddingHorizontal: theme.space.md }}
        ListEmptyComponent={<EmptyState title="No orders yet" message="New orders show up here." />}
        refreshing={pulling}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <ListRow
            title={`#${item.display_id} · ${formatMoney(Number(item.total), item.currency_code)}`}
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
          headerRight: () => <Button label="Settings" variant="link" onPress={() => router.push('/settings')} />,
        }}
      />
      {content()}
    </>
  );
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
});
