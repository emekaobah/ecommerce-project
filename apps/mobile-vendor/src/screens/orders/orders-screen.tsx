import { Button, EmptyState, ErrorState, ListRow, LoadingState, StatusChip, useTheme, type StatusTone } from '@oja/ui';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { useOrders } from '@/api/orders';
import { useCurrentSeller } from '@/api/sellers';
import { useSession } from '@/session/session-store';
import { signOut } from '@/session/sign-out';

// Medusa order statuses; the fulfilment state machine replaces these with its own states.
const STATUS_TONES: Partial<Record<string, StatusTone>> = {
  pending: 'info',
  completed: 'success',
  canceled: 'danger',
  requires_action: 'warning',
};

export function OrdersScreen() {
  const theme = useTheme();
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
            subtitle={new Date(item.created_at).toLocaleString()}
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
          headerRight: () => <Button label="Sign out" variant="link" onPress={() => void signOut()} />,
        }}
      />
      {content()}
    </>
  );
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
});
