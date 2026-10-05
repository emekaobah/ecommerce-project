import { formatMoney } from '@oja/domain';
import { Button, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { orderValue, useAcceptOrder, useOrder, useStartPicking } from '@/api/orders';
import { FulfilmentChip } from '@/orders/fulfilment-chip';
import { lineLabel } from '@/orders/items';
import { useNow } from '@/orders/use-now';

/**
 * One order: its state, the deadline to accept it while it is new, its items, and what staff do
 * next: Accept / Reject while new, then pick and pack.
 */
export function OrderScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const accept = useAcceptOrder(id);
  const startPicking = useStartPicking(id);
  const openPickList = () => router.push({ pathname: '/orders/[id]/pick', params: { id } });
  const now = useNow();

  const content = () => {
    if (order.error && !order.data) {
      return <ErrorState title="Couldn't load the order" message={order.error.message} onRetry={() => void order.refetch()} />;
    }
    if (!order.data) return <LoadingState />;
    const { fulfilment, items, currency_code } = order.data;
    const isNew = fulfilment.state === 'new';

    return (
      <ScrollView contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg }}>
        <View style={{ gap: theme.space.sm }}>
          <FulfilmentChip fulfilment={fulfilment} now={now} />
          {isNew && fulfilment.accept_by ? (
            <Text tone="secondary">Accept by {new Date(fulfilment.accept_by).toLocaleString()}, or it is rejected and refunded.</Text>
          ) : null}
          {fulfilment.state === 'packed' ? <Text tone="secondary">Packed, ready for a courier label.</Text> : null}
          {fulfilment.state === 'rejected' ? (
            <Text tone="secondary">
              {fulfilment.rejected_by === 'accept_deadline' ? 'Not accepted in time.' : `Rejected: ${fulfilment.reject_reason}.`} The
              buyer's payment for this order is being refunded.
            </Text>
          ) : null}
        </View>

        <View>
          {(items ?? []).map((item) => (
            <ListRow key={item.id} title={lineLabel(item)} />
          ))}
          <ListRow title="Total" trailing={<Text variant="label">{formatMoney(orderValue(order.data), currency_code)}</Text>} />
        </View>

        {isNew ? (
          <View style={{ gap: theme.space.sm }}>
            {accept.error ? <Text tone="danger">{accept.error.message}</Text> : null}
            <Button label="Accept order" onPress={() => accept.mutate()} loading={accept.isPending} />
            <Button
              label="Reject order"
              variant="secondary"
              disabled={accept.isPending}
              onPress={() => router.push({ pathname: '/orders/[id]/reject', params: { id } })}
            />
          </View>
        ) : null}

        {fulfilment.state === 'accepted' ? (
          <View style={{ gap: theme.space.sm }}>
            {startPicking.error ? <Text tone="danger">{startPicking.error.message}</Text> : null}
            <Button
              label="Start picking"
              loading={startPicking.isPending}
              onPress={() => startPicking.mutate(undefined, { onSuccess: openPickList })}
            />
          </View>
        ) : null}
        {fulfilment.state === 'picking' ? <Button label="Continue picking" onPress={openPickList} /> : null}
      </ScrollView>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: order.data ? `Order #${order.data.display_id}` : 'Order' }} />
      {content()}
    </>
  );
}
