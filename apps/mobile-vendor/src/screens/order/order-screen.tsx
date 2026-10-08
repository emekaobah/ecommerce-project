import { formatMoney } from '@oja/domain';
import { Button, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, ScrollView, View } from 'react-native';

import { orderValue, useAcceptOrder, useBookLabel, useOrder, useStartPicking, type OrderFulfilment } from '@/api/orders';
import { FulfilmentChip } from '@/orders/fulfilment-chip';
import { lineLabel } from '@/orders/items';
import { useNow } from '@/orders/use-now';

/**
 * One order: its state, the deadline to accept it while it is new, its items, and what staff do
 * next: Accept / Reject while new, then pick and pack, then book (or rebook) the courier label.
 */
export function OrderScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const now = useNow();

  const content = () => {
    if (order.error && !order.data) {
      return <ErrorState title="Couldn't load the order" message={order.error.message} onRetry={() => void order.refetch()} />;
    }
    if (!order.data) return <LoadingState />;
    const { fulfilment, items, currency_code } = order.data;

    return (
      <ScrollView contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg }}>
        <View style={{ gap: theme.space.sm }}>
          <FulfilmentChip fulfilment={fulfilment} now={now} />
          <StateNote fulfilment={fulfilment} />
        </View>

        <CourierLabel fulfilment={fulfilment} />

        <View>
          {(items ?? []).map((item) => (
            <ListRow key={item.id} title={lineLabel(item)} />
          ))}
          <ListRow title="Total" trailing={<Text variant="label">{formatMoney(orderValue(order.data), currency_code)}</Text>} />
        </View>

        <NextStep orderId={id} fulfilment={fulfilment} />
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

/** What the order's state means for staff: the accept deadline, packed, or why it was rejected. */
function StateNote({ fulfilment }: Readonly<{ fulfilment: OrderFulfilment }>) {
  if (fulfilment.state === 'new' && fulfilment.accept_by) {
    return <Text tone="secondary">Accept by {new Date(fulfilment.accept_by).toLocaleString()}, or it is rejected and refunded.</Text>;
  }
  if (fulfilment.state === 'packed' && fulfilment.shipment?.cancelled) {
    return <Text tone="secondary">Shipbubble cancelled the courier booking. Book a new label to send it.</Text>;
  }
  if (fulfilment.state === 'packed') return <Text tone="secondary">Packed, ready for a courier label.</Text>;
  if (fulfilment.state === 'label_booked') {
    return <Text tone="secondary">Label booked. Waiting for the courier to confirm the pickup.</Text>;
  }
  if (fulfilment.state === 'courier_confirmed') {
    return <Text tone="secondary">The courier confirmed the pickup. Keep the parcel ready at the counter.</Text>;
  }
  if (fulfilment.state === 'rejected') {
    return (
      <Text tone="secondary">
        {fulfilment.rejected_by === 'accept_deadline' ? 'Not accepted in time.' : `Rejected: ${fulfilment.reject_reason}.`} The
        buyer's payment for this order is being refunded.
      </Text>
    );
  }
  return null;
}

/** The courier label booked for the order: the courier, its waybill and a link to track it. */
function CourierLabel({ fulfilment }: Readonly<{ fulfilment: OrderFulfilment }>) {
  const { shipment } = fulfilment;
  if (!shipment || shipment.cancelled) return null;
  return (
    <View>
      <ListRow title={shipment.courier_name ?? 'Courier'} subtitle={`Waybill ${shipment.waybill}`} />
      <ListRow
        title="Track shipment"
        trailing={<Text tone="secondary">›</Text>}
        onPress={() => void Linking.openURL(shipment.tracking_url)}
      />
    </View>
  );
}

/** What staff do next with the order: Accept / Reject while new, pick it, then book its courier label. */
function NextStep({ orderId, fulfilment }: Readonly<{ orderId: string; fulfilment: OrderFulfilment }>) {
  const theme = useTheme();
  const router = useRouter();
  const accept = useAcceptOrder(orderId);
  const startPicking = useStartPicking(orderId);
  const bookLabel = useBookLabel(orderId);
  const { state } = fulfilment;
  const openPickList = () => router.push({ pathname: '/orders/[id]/pick', params: { id: orderId } });

  if (state === 'new') {
    return (
      <View style={{ gap: theme.space.sm }}>
        {accept.error ? <Text tone="danger">{accept.error.message}</Text> : null}
        <Button label="Accept order" onPress={() => accept.mutate()} loading={accept.isPending} />
        <Button
          label="Reject order"
          variant="secondary"
          disabled={accept.isPending}
          onPress={() => router.push({ pathname: '/orders/[id]/reject', params: { id: orderId } })}
        />
      </View>
    );
  }
  if (state === 'accepted') {
    return (
      <View style={{ gap: theme.space.sm }}>
        {startPicking.error ? <Text tone="danger">{startPicking.error.message}</Text> : null}
        <Button
          label="Start picking"
          loading={startPicking.isPending}
          onPress={() => startPicking.mutate(undefined, { onSuccess: openPickList })}
        />
      </View>
    );
  }
  // Partially available (#22) is still being picked: its unavailable items wait on the pick list.
  if (state === 'picking' || state === 'partially_available') {
    return <Button label="Continue picking" onPress={openPickList} />;
  }
  if (state === 'packed') {
    return (
      <View style={{ gap: theme.space.sm }}>
        {bookLabel.error ? <Text tone="danger">{bookLabel.error.message}</Text> : null}
        <Button
          label={fulfilment.shipment?.cancelled ? 'Rebook courier label' : 'Book courier label'}
          loading={bookLabel.isPending}
          onPress={() => bookLabel.mutate()}
        />
      </View>
    );
  }
  return null;
}
