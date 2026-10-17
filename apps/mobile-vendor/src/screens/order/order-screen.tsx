import { canCancel, cancelledBy, cancelReasonText, collectByLabel, formatMoney } from '@oja/domain';
import { Button, ErrorState, ListRow, LoadingState, Text, Timeline, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, ScrollView, View } from 'react-native';

import {
  orderValue,
  useAcceptOrder,
  useBookLabel,
  useConfirmHandover,
  useOrder,
  useStartPicking,
  type OrderFulfilment,
} from '@/api/orders';
import { useMayManageShop } from '@/api/sellers';
import { FulfilmentChip } from '@/orders/fulfilment-chip';
import { lineLabel } from '@/orders/items';
import { useNow } from '@/orders/use-now';
import { useSession } from '@/session/session-store';

/**
 * One order: its state, the deadline to accept it while it is new, its items, and what staff do
 * next: Accept / Reject while new, then pick and pack, book (or rebook) the courier label, and
 * confirm the handover to the courier. Owners and managers can cancel it once accepted, until its
 * courier label is booked (#17). Its timeline shows how far it has got.
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
        <CancelOrder orderId={id} fulfilment={fulfilment} />

        {fulfilment.timeline.length ? <Timeline steps={fulfilment.timeline} /> : null}
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
  if (fulfilment.state === 'courier_confirmed') return <HandoverNote fulfilment={fulfilment} />;
  const note = stateNote(fulfilment);
  return note ? <Text tone="secondary">{note}</Text> : null;
}

/** The note for a state that always reads the same. */
const STATE_NOTES: { [S in OrderFulfilment['state']]?: string } = {
  packed: 'Packed, ready for a courier label.',
  label_booked: 'Label booked. Waiting for the courier to confirm the pickup.',
  handed_to_courier: 'With the courier, on its way to the buyer.',
  in_transit: 'In transit to the buyer.',
  delivered: 'Delivered to the buyer.',
  ready_for_pickup: 'Ready at the counter. The buyer collects it with the code in their app.',
  not_collected: "Not collected in time. The buyer is refunded all but the fresh items, which are the shop's and paid out.",
};

/** A pickup order's states before it is packed, when staff are told the buyer collects it. */
const BEFORE_PACKING = new Set<OrderFulfilment['state']>(['new', 'accepted', 'picking', 'partially_available']);

/** The notes that say more of the order than its state: none when the order lacks what they tell. */
const DETAILED_NOTES: Partial<Record<OrderFulfilment['state'], (fulfilment: OrderFulfilment) => string | null>> = {
  new: ({ accept_by }) => (accept_by ? `Accept by ${new Date(accept_by).toLocaleString()}, or it is rejected and refunded.` : null),
  ready_for_pickup: ({ collect_by }) =>
    collect_by
      ? `Ready at the counter. The buyer collects it with the code in their app. ${collectByLabel(collect_by.at, new Date(), collect_by.time_zone)}, or it is not collected.`
      : null,
  packed: ({ shipment }) => (shipment?.cancelled ? 'Shipbubble cancelled the courier booking. Book a new label to send it.' : null),
  collected: ({ collection }) =>
    collection
      ? `Handed over by ${collection.staff.name ?? 'a staff member'} to ${collection.collected_by} at ${timeOf(collection.staff.at)}.`
      : null,
  rejected: ({ rejected_by, reject_reason }) => {
    const why = rejected_by === 'accept_deadline' ? 'Not accepted in time.' : `Rejected: ${reject_reason}.`;
    return `${why} The buyer's payment for this order is being refunded.`;
  },
  cancelled: ({ cancellation }) =>
    cancellation
      ? `Cancelled by ${cancelledBy(cancellation.by)}: ${cancelReasonText(cancellation)}. The buyer is refunded all they paid for it.`
      : null,
};

function stateNote(fulfilment: OrderFulfilment): string | null {
  const { state } = fulfilment;
  const detailed = DETAILED_NOTES[state]?.(fulfilment);
  if (detailed) return detailed;
  if (fulfilment.method === 'pickup' && BEFORE_PACKING.has(state)) return 'The buyer collects this order in store.';
  return STATE_NOTES[state] ?? null;
}

const timeOf = (at: string) => new Date(at).toLocaleTimeString(undefined, { timeStyle: 'short' });

/** Where the handover stands while the courier is booked: it needs both staff's tap and the courier's pickup. */
function HandoverNote({ fulfilment }: Readonly<{ fulfilment: OrderFulfilment }>) {
  const staff = fulfilment.handover?.staff;
  const pickedUpAt = fulfilment.handover?.picked_up_at;
  if (staff) {
    return (
      <Text tone="secondary">
        {`Handed over by ${staff.name ?? 'a staff member'} at ${timeOf(staff.at)}. Waiting for the courier to confirm the pickup.`}
      </Text>
    );
  }
  if (pickedUpAt) {
    return (
      <Text tone="secondary">
        {`The courier says they collected it at ${timeOf(pickedUpAt)}. Confirm you handed it over.`}
      </Text>
    );
  }
  return <Text tone="secondary">The courier confirmed the pickup. Keep the parcel ready at the counter.</Text>;
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
  const handOver = useConfirmHandover(orderId);
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
      <Action
        label="Start picking"
        mutation={startPicking}
        onPress={() => startPicking.mutate(undefined, { onSuccess: openPickList })}
      />
    );
  }
  // Partially available (#22) is still being picked: its unavailable items wait on the pick list.
  if (state === 'picking' || state === 'partially_available') {
    return <Button label="Continue picking" onPress={openPickList} />;
  }
  if (state === 'packed') {
    return (
      <Action
        label={fulfilment.shipment?.cancelled ? 'Rebook courier label' : 'Book courier label'}
        mutation={bookLabel}
        onPress={() => bookLabel.mutate()}
      />
    );
  }
  if (state === 'ready_for_pickup') {
    return <Button label="Hand over to buyer" onPress={() => router.push({ pathname: '/orders/[id]/collect', params: { id: orderId } })} />;
  }
  if (state === 'courier_confirmed' && !fulfilment.handover?.staff) {
    return <Action label="Handed to courier" mutation={handOver} onPress={() => handOver.mutate()} />;
  }
  return null;
}

/**
 * Cancel order (#17), for owners and managers while the order can be cancelled: accepted, and
 * no courier label booked yet. Fulfilment staff don't see it; the API refuses them anyway.
 */
function CancelOrder({ orderId, fulfilment }: Readonly<{ orderId: string; fulfilment: OrderFulfilment }>) {
  const router = useRouter();
  const mayManage = useMayManageShop(useSession()?.sellerId);
  if (!canCancel(fulfilment.state) || !mayManage.data) return null;
  return (
    <Button
      label="Cancel order"
      variant="secondary"
      onPress={() => router.push({ pathname: '/orders/[id]/cancel', params: { id: orderId } })}
    />
  );
}

/** A step's one action, with why it last failed above it. */
function Action({
  label,
  mutation,
  onPress,
}: Readonly<{ label: string; mutation: { error: Error | null; isPending: boolean }; onPress: () => void }>) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space.sm }}>
      {mutation.error ? <Text tone="danger">{mutation.error.message}</Text> : null}
      <Button label={label} loading={mutation.isPending} onPress={onPress} />
    </View>
  );
}
