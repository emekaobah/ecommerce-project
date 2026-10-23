import {
  asSentence,
  canCancel,
  cancelledBy,
  cancelReasonText,
  collectByLabel,
  formatMoney,
  handoverSteps,
  openingLabel,
  orderBuyerLine,
  staffStatus,
} from '@oja/domain';
import {
  Band,
  Button,
  haptics,
  Icon,
  ErrorState,
  ListRow,
  PressableSurface,
  QuantityPill,
  Skeleton,
  Text,
  Timeline,
  useTheme,
  useToast,
} from '@oja/ui';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { orderValue, useAcceptOrder, useOrder, type Order, type OrderFulfilment } from '@/api/orders';
import { useMayManageShop } from '@/api/sellers';
import { useShopHours } from '@/api/shop-hours';
import { ApprovalNote, BookCourier } from '@/orders/courier-choice';
import { AcceptClockPill } from '@/orders/fulfilment-chip';
import { shopHoursOf } from '@/orders/shop-state';
import { useNow } from '@/orders/use-now';
import { useSession } from '@/session/session-store';

/**
 * One order: an indigo band with its state, who it is for and, while it is new, the accept
 * clock; its lines with their unit prices and Perishable tags, and its total. While it is new,
 * Reject and Accept order sit at the foot: accepting starts picking. Then pick and pack, book (or
 * rebook) the courier label, and confirm the handover to the courier: from the label on, the
 * handover's timeline shows which half (the staff tap, the courier's pickup) is still missing,
 * with Handed to courier the one primary button. Owners and managers can cancel it once
 * accepted, until its courier label is booked (#17). Its timeline shows how far it has got.
 */
export function OrderScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const shop = useShopHours(useSession()?.sellerId);
  const hours = shopHoursOf(shop.data);
  const now = useNow();

  const content = () => {
    if (order.error && !order.data) {
      return (
        <ErrorState
          title="Couldn't load the order"
          body="Check your connection and try again. Nothing about the order has changed."
          error={order.error}
          onRetry={() => void order.refetch()}
        />
      );
    }
    if (!order.data) return <OrderSkeleton />;
    const { fulfilment, currency_code } = order.data;
    const isNew = fulfilment.state === 'new';
    const timeZone = shop.data?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formatTime = (at: string) => openingLabel(at, now, timeZone);

    if (isWithCourier(fulfilment)) {
      return <Handover orderId={id} order={order.data} formatTime={formatTime} />;
    }

    return (
      <>
        <ScrollView contentContainerStyle={{ paddingBottom: theme.space[6] }}>
          <Band style={{ gap: theme.space[2] }}>
            <Text variant="titleNamed" tone="onBand">
              {`${staffStatus(fulfilment.state).label} · ${fulfilment.method}`}
            </Text>
            <Text variant="meta" tone="onBand">
              {orderBuyerLine(order.data, timeZone)}
            </Text>
          </Band>

          <View style={{ padding: theme.space[4], gap: theme.space[6] }}>
            {/* Only when there is a note: an empty block would still take the gap below the band. */}
            {!isNew && (stateNote(fulfilment) || fulfilment.courier_approval) ? (
              <View style={{ gap: theme.space[2] }}>
                <StateNote fulfilment={fulfilment} />
                <ApprovalNote fulfilment={fulfilment} currency={currency_code} />
              </View>
            ) : null}

            <CourierLabel fulfilment={fulfilment} />

            <Lines order={order.data} />

            {isNew ? null : <NextStep orderId={id} fulfilment={fulfilment} currency={currency_code} />}
            <CancelOrder orderId={id} fulfilment={fulfilment} />

            {/* A new order has only been placed: its timeline starts once it's accepted. */}
            {!isNew && fulfilment.timeline.length ? <Timeline steps={fulfilment.timeline} formatTime={formatTime} /> : null}
          </View>
        </ScrollView>
        {isNew ? <AcceptOrReject orderId={id} displayId={order.data.display_id} /> : null}
      </>
    );
  };

  // While it's new, the accept clock sits at the header's end, on the band's row (iOS: outside the bar's glass).
  const acceptBy = order.data?.fulfilment.state === 'new' ? order.data.fulfilment.accept_by : null;
  const renderClock = () => (acceptBy ? <AcceptClockPill acceptBy={acceptBy} now={now} hours={hours} /> : null);
  return (
    <>
      <Stack.Screen
        options={{
          title: order.data ? `Order #${order.data.display_id}` : 'Order',
          headerRight: renderClock,
          unstable_headerRightItems: () =>
            acceptBy
              ? [{ type: 'custom', element: <AcceptClockPill acceptBy={acceptBy} now={now} hours={hours} />, hidesSharedBackground: true }]
              : [],
        }}
      />
      {content()}
    </>
  );
}

/** The order's shape while it loads: the band, then rows of photo, name and quantity, and the total. */
function OrderSkeleton() {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel="Loading the order">
      <Band style={{ gap: theme.space[2] }}>
        <View style={{ height: theme.type.titleNamed.lineHeight }} />
        <View style={{ height: theme.type.meta.lineHeight }} />
      </Band>
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        {[0, 1].map((row) => (
          <View key={row} style={[styles.row, { gap: theme.space[2] }]}>
            <Skeleton width={theme.control.md} height={theme.control.md} radius="md" />
            <View style={[styles.grow, { gap: theme.space[2] }]}>
              <Skeleton width="60%" height={theme.space[3]} radius="pill" />
              <Skeleton width="35%" height={theme.space[3]} radius="pill" />
            </View>
            <Skeleton width={theme.control.md} height={theme.space[8]} radius="pill" />
          </View>
        ))}
        <View style={[styles.row, styles.between, { paddingTop: theme.space[4] }]}>
          <Skeleton width="30%" height={theme.space[4]} radius="pill" />
          <Skeleton width="35%" height={theme.space[5]} radius="pill" />
        </View>
      </View>
    </View>
  );
}

/** The order's lines, each with its photo, unit price, Perishable tag and quantity, then the total. */
function Lines({ order }: Readonly<{ order: Order }>) {
  const theme = useTheme();
  const photo = theme.control.md;
  return (
    <View style={{ gap: theme.space[3] }}>
      {(order.items ?? []).map((item) => (
        <View
          key={item.id}
          accessible
          accessibilityLabel={[
            `${Number(item.quantity)} × ${item.product_title ?? 'Item'}`,
            `${formatMoney(Number(item.unit_price), order.currency_code)} each`,
            item.perishable ? 'Perishable' : null,
          ]
            .filter(Boolean)
            .join(', ')}
          style={[styles.row, { gap: theme.space[2] }]}>
          <View style={{ width: photo, height: photo, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.productTile }}>
            {item.thumbnail ? <Image source={{ uri: item.thumbnail }} contentFit="contain" style={StyleSheet.absoluteFill} /> : null}
          </View>
          <View style={styles.grow}>
            <Text weight="bold">{item.product_title ?? 'Item'}</Text>
            {/* A plain muted tag, as on the takeover (catalogue v-triage #3). */}
            <Text variant="meta" tone="muted" tabular>
              {`${item.perishable ? 'Perishable · ' : ''}${formatMoney(Number(item.unit_price), order.currency_code)} each`}
            </Text>
          </View>
          <QuantityPill label={`×${Number(item.quantity)}`} />
        </View>
      ))}
      <View style={[styles.row, styles.between, { paddingTop: theme.space[4] }]}>
        <Text variant="strong">Order total</Text>
        <Text variant="heading" tabular>
          {formatMoney(orderValue(order), order.currency_code)}
        </Text>
      </View>
    </View>
  );
}

/** Reject and Accept order at the foot of a new order. Accepting starts picking straight away. */
function AcceptOrReject({ orderId, displayId }: Readonly<{ orderId: string; displayId: number }>) {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const accept = useAcceptOrder(orderId);
  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.row, { gap: theme.space[2], paddingHorizontal: theme.space[3], paddingTop: theme.space[2], backgroundColor: theme.colors.bg }]}>
      <PressableSurface
        accessibilityRole="button"
        accessibilityLabel="Reject"
        disabled={accept.isPending}
        onPress={() => router.push({ pathname: '/orders/[id]/reject', params: { id: orderId } })}
        style={[
          styles.centre,
          styles.reject,
          {
            minHeight: theme.control.main,
            paddingHorizontal: theme.space[6],
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.dangerBg,
          },
        ]}>
        <Text variant="strong" tone="danger">
          Reject
        </Text>
      </PressableSurface>
      <Button
        label="Accept order"
        size="main"
        style={styles.grow}
        loading={accept.isPending}
        onPress={() =>
          accept.mutate(undefined, {
            // The order is now in Picking: the screen shows the pick list's way in.
            onSuccess: () => haptics.success(),
            onError: () => toast({ message: `Couldn't accept order #${displayId}. Pull to see where it is now.`, tone: 'problem' }),
          })
        }
      />
    </SafeAreaView>
  );
}

/** A delivery order from its label being booked until it is handed over: waiting on the courier, then on the handover's halves. */
const isWithCourier = (fulfilment: OrderFulfilment) =>
  fulfilment.method === 'delivery' && (fulfilment.state === 'label_booked' || fulfilment.state === 'courier_confirmed');

/**
 * The handover to the courier (catalogue v-hand #1): the band with the waybill, a timeline that
 * shows which half of the handover is still missing, the parcel's tracking and lines, and while
 * staff haven't tapped it yet, Handed to courier, which asks first (`hand-over`).
 */
function Handover({ orderId, order, formatTime }: Readonly<{ orderId: string; order: Order; formatTime: (at: string) => string }>) {
  const theme = useTheme();
  const router = useRouter();
  const { fulfilment, currency_code } = order;
  const confirmed = fulfilment.state === 'courier_confirmed';
  const awaitingTap = confirmed && !fulfilment.handover?.staff;
  return (
    <>
      <ScrollView contentContainerStyle={{ paddingBottom: theme.space[6] }}>
        <Band style={{ gap: theme.space[2] }}>
          {fulfilment.shipment ? (
            <Text variant="meta" tone="onBand" tabular>
              {`Waybill ${fulfilment.shipment.waybill}`}
            </Text>
          ) : null}
          <Text variant="titleNamed" tone="onBand">
            {confirmed ? 'Courier on the way' : 'Courier booked'}
          </Text>
        </Band>
        <View style={{ padding: theme.space[4], gap: theme.space[6] }}>
          <Timeline steps={handoverSteps(fulfilment)} formatTime={formatTime} />
          <ApprovalNote fulfilment={fulfilment} currency={currency_code} />
          {/* The band names the waybill and the timeline the courier: only the tracking link is left. */}
          {fulfilment.shipment ? (
            <ListRow
              title="Track shipment"
              subtitle={fulfilment.shipment.switched_from ? `Instead of ${fulfilment.shipment.switched_from}` : undefined}
              trailing={<Icon name="fwd" color={theme.colors.muted} />}
              onPress={() => void Linking.openURL(fulfilment.shipment!.tracking_url)}
            />
          ) : null}
          <Lines order={order} />
        </View>
      </ScrollView>
      {awaitingTap ? (
        <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: theme.space[3], paddingTop: theme.space[2], backgroundColor: theme.colors.bg }}>
          <Button
            label="Handed to courier"
            size="main"
            trailingIcon="check"
            onPress={() => router.push({ pathname: '/orders/[id]/hand-over', params: { id: orderId } })}
          />
        </SafeAreaView>
      ) : null}
    </>
  );
}

/** What the order's state means for staff: the accept deadline, packed, or why it was rejected. */
function StateNote({ fulfilment }: Readonly<{ fulfilment: OrderFulfilment }>) {
  const note = stateNote(fulfilment);
  return note ? <Text tone="muted">{note}</Text> : null;
}

/** The note for a state that always reads the same. */
const STATE_NOTES: { [S in OrderFulfilment['state']]?: string } = {
  packed: 'Packed, ready for a courier label.',
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
    const why = rejected_by === 'accept_deadline' ? 'Not accepted in time.' : `Rejected: ${asSentence(reject_reason ?? '')}`;
    return `${why} The buyer's payment for this order is being refunded.`;
  },
  cancelled: ({ cancellation }) =>
    cancellation
      ? `Cancelled by ${cancelledBy(cancellation.by)}: ${asSentence(cancelReasonText(cancellation))} The buyer is refunded all they paid for it.`
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

/**
 * The courier label booked for the order: the courier, its waybill and a link to track it, and
 * the buyer's courier when another was booked (#19).
 */
function CourierLabel({ fulfilment }: Readonly<{ fulfilment: OrderFulfilment }>) {
  const { shipment } = fulfilment;
  if (!shipment || shipment.cancelled) return null;
  const instead = shipment.switched_from ? ` · instead of ${shipment.switched_from}` : '';
  return (
    <View>
      <ListRow title={shipment.courier_name} subtitle={`Waybill ${shipment.waybill}${instead}`} />
      <ListRow
        title="Track shipment"
        trailing={<Text tone="muted">›</Text>}
        onPress={() => void Linking.openURL(shipment.tracking_url)}
      />
    </View>
  );
}

/**
 * What staff do next with an accepted order: pick it, then book its courier label, choosing
 * another courier when the buyer's costs more than Oja tops up (#19).
 */
function NextStep({ orderId, fulfilment, currency }: Readonly<{ orderId: string; fulfilment: OrderFulfilment; currency: string }>) {
  const router = useRouter();
  const { state } = fulfilment;
  const openPickList = () => router.push({ pathname: '/orders/[id]/pick', params: { id: orderId } });

  // Partially available (#22) is still being picked: its unavailable items wait on the pick list.
  if (state === 'picking' || state === 'partially_available') {
    return <Button label="Continue picking" onPress={openPickList} />;
  }
  if (state === 'packed') {
    return <BookCourier orderId={orderId} rebook={!!fulfilment.shipment?.cancelled} currency={currency} />;
  }
  if (state === 'ready_for_pickup') {
    return <Button label="Hand over to buyer" onPress={() => router.push({ pathname: '/orders/[id]/collect', params: { id: orderId } })} />;
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

const styles = StyleSheet.create({
  // Reject takes a little less of the row than Accept order (the catalogue's 44 to 56).
  reject: { flex: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
