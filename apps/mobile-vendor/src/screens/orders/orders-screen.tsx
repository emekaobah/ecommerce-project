import { formatMoney } from '@oja/domain';
import { Button, EmptyState, ErrorState, ListRow, LoadingState, StatusChip, useTheme, type StatusTone } from '@oja/ui';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { useOrders } from '@/api/orders';
import { useCurrentSeller } from '@/api/sellers';
import { useSession } from '@/session/session-store';

// Medusa order statuses; the fulfilment state machine replaces these with its own states.
const STATUS_TONES: Partial<Record<string, StatusTone>> = {
  pending: 'info',
  completed: 'success',
  canceled: 'danger',
  requires_action: 'warning',
};

export function OrdersScreen() {
  const theme = useTheme();
  const router = useRouter();
  const sellerId = useSession()?.sellerId;
  const seller = useCurrentSeller(sellerId);
  const orders = useOrders(sellerId);
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
            title={`#${item.display_id}`}
            subtitle={[
              formatMoney(Number(item.total), item.currency_code),
              itemCount(item.items),
              new Date(item.created_at).toLocaleString(),
            ].join(' · ')}
            trailing={
              <StatusChip label={item.status.replaceAll('_', ' ')} tone={STATUS_TONES[item.status] ?? 'neutral'} />
            }
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

function itemCount(items: { quantity: number | string }[] | null | undefined) {
  const count = (items ?? []).reduce((total, item) => total + Number(item.quantity), 0);
  return count === 1 ? '1 item' : `${count} items`;
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
});
