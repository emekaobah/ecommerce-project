import { buyerCourierQuote, pickBand, pickLineView } from '@oja/domain';
import {
  Band,
  Button,
  EmptyState,
  ErrorState,
  haptics,
  InlineNote,
  PressableSurface,
  QuantityPill,
  Skeleton,
  Text,
  useTheme,
} from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useFailureMessage } from '@/api/errors';
import { useOrder, usePackOrder, usePickList, useRecordPick, type Order, type PickList, type PickListLine } from '@/api/orders';

import { CancelInstead } from './cancel-instead';
import { LinePhoto } from './line-photo';

/**
 * The picking checklist (catalogue v-pick #1): an indigo band with how the order goes out and
 * how far picking has got, then each line with its quantity pill. A tap ticks a line (or puts it
 * back); opening it, by long-press or the screen reader's action, marks items not available.
 * Scan item is the thumb action. Packed opens once no line is left to pick: straight to packing,
 * or first to the refund summary while items marked short wait to be removed (#22); when every
 * item is short, the order is cancelled instead (#17).
 */
export function PickScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const pickList = usePickList(id);
  const recordPick = useRecordPick(id);
  const pack = usePackOrder(id);
  // A failed pack or tick in plain words; a pack the API refused (the order moved on) in its own.
  const packFailure = useFailureMessage(pack.error, [400, 409], "Couldn't mark the order packed. Check your connection and try again.");
  const tickFailure = useFailureMessage(recordPick.error, [], "Couldn't save that tick. Check your connection; the list shows what's saved.");

  const markShort = (line: PickListLine) =>
    router.push({ pathname: '/orders/[id]/unavailable', params: { id, item: line.id } });

  // A tap picks the whole line (all of it still available), or puts a fully picked line back to none.
  // A line with nothing left to pick opens to change how many are short.
  const toggle = (line: PickListLine) => {
    const available = line.quantity - line.unavailable;
    if (available <= 0) return markShort(line);
    haptics.selection();
    recordPick.mutate({ itemId: line.id, picked: line.picked >= available ? 0 : available });
  };

  const content = () => {
    if (pickList.error && !pickList.data) {
      return (
        <ErrorState
          title="Couldn't load the pick list"
          body="Check your connection and try again. Nothing you've picked is lost."
          error={pickList.error}
          onRetry={() => void pickList.refetch()}
        />
      );
    }
    if (!pickList.data) return <PickListSkeleton />;
    const { lines, progress } = pickList.data;
    if (!lines.length) return <EmptyState title="Nothing to pick" body="This order has no items." />;

    return (
      <>
        <ScrollView contentContainerStyle={{ paddingBottom: theme.space[6] }}>
          <PickBand pickList={pickList.data} order={order.data} />
          <View style={{ paddingVertical: theme.space[1] }}>
            {lines.map((line) => (
              <PickRow key={line.id} line={line} onTick={() => toggle(line)} onOpen={() => markShort(line)} />
            ))}
          </View>
          {progress.allUnavailable ? (
            <View style={{ paddingHorizontal: theme.space[4] }}>
              <CancelInstead orderId={id} />
            </View>
          ) : null}
        </ScrollView>
        <PickFoot
          pickList={pickList.data}
          problem={packFailure ?? tickFailure}
          packing={pack.isPending}
          onScan={() => router.push({ pathname: '/orders/[id]/scan', params: { id } })}
          onPacked={() => {
            // Short items come off the order, refunded, before anything is packed.
            if (progress.unavailable > 0) {
              router.push({ pathname: '/orders/[id]/remove-unavailable', params: { id } });
              return;
            }
            pack.mutate(undefined, {
              onSuccess: () => {
                haptics.success();
                router.replace({ pathname: '/orders/[id]/packed', params: { id } });
              },
            });
          }}
        />
      </>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: order.data ? `Order #${order.data.display_id}` : 'Pick items' }} />
      {content()}
    </>
  );
}

/** "Delivery · GIG Logistics", "Picking · 3 of 5" and the sun progress bar with its percentage. */
function PickBand({ pickList, order }: Readonly<{ pickList: PickList; order: Order | undefined }>) {
  const theme = useTheme();
  const band = pickBand(pickList.progress);
  const percent = Math.round(band.fraction * 100);
  return (
    <Band style={{ gap: theme.space[2] }}>
      {order ? (
        <Text variant="meta" weight="bold" tone="onBand" style={styles.end}>
          {goesOut(order)}
        </Text>
      ) : null}
      <Text variant="titleNamed" tone="onBand" accessibilityLiveRegion="polite">
        {band.label}
      </Text>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Picked"
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        style={[styles.row, { gap: theme.space[3] }]}>
        <View style={[styles.track, { height: theme.space[2], borderRadius: theme.space[1], backgroundColor: theme.colors.onBandTile }]}>
          <View style={{ width: `${percent}%`, height: '100%', backgroundColor: theme.colors.sun }} />
        </View>
        <Text variant="meta" weight="extrabold" tone="onBand" tabular>
          {`${percent}%`}
        </Text>
      </View>
    </Band>
  );
}

/** How the order leaves the shop: "Pickup", or "Delivery" with the courier the buyer chose. */
function goesOut(order: Order) {
  if (order.fulfilment.method === 'pickup') return 'Pickup';
  const courier = buyerCourierQuote(order)?.courier_name;
  return courier ? `Delivery · ${courier}` : 'Delivery';
}

/**
 * One line: photo, name, what is left of it and its pill. Tap ticks it; long-press (a shortcut)
 * or the screen reader's "Mark items not available" opens the Not available sheet.
 */
function PickRow({ line, onTick, onOpen }: Readonly<{ line: PickListLine; onTick: () => void; onOpen: () => void }>) {
  const theme = useTheme();
  const view = pickLineView(line);
  const name = line.product_title ?? 'Item';
  const variant = line.variant_title && line.variant_title !== line.product_title ? line.variant_title : null;
  const available = line.quantity - line.unavailable;
  let hint = 'Ticks it picked';
  if (available <= 0) hint = 'Opens it to change how many are not available';
  else if (line.picked >= available) hint = 'Puts it back';
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={[name, variant, view.spoken].filter(Boolean).join(', ')}
      accessibilityHint={hint}
      accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: 'Mark items not available' }]}
      onAccessibilityAction={(event) => (event.nativeEvent.actionName === 'longpress' ? onOpen() : onTick())}
      onPress={onTick}
      onLongPress={onOpen}
      ringInset
      style={[styles.row, { gap: theme.space[3], paddingVertical: theme.space[3], paddingHorizontal: theme.space[4], minHeight: theme.hitArea }]}>
      <LinePhoto uri={line.thumbnail} />
      <View style={styles.grow}>
        <Text weight="bold">{name}</Text>
        {variant ? (
          <Text variant="meta" tone="muted">
            {variant}
          </Text>
        ) : null}
        <Text variant="meta" tone={view.noteTone === 'ember' ? 'ember' : 'muted'}>
          {view.note}
        </Text>
      </View>
      <QuantityPill label={view.pill.label} tone={view.pill.tone} />
    </PressableSurface>
  );
}

/**
 * The foot bar: Scan item (indigo, the thumb's) and Packed. Packed waits until no line is left
 * to pick; while items marked short wait to be removed, it opens the refund summary first.
 */
function PickFoot({
  pickList,
  problem,
  packing,
  onScan,
  onPacked,
}: Readonly<{ pickList: PickList; problem: string | null; packing: boolean; onScan: () => void; onPacked: () => void }>) {
  const theme = useTheme();
  return (
    <SafeAreaView
      edges={['bottom']}
      style={{ gap: theme.space[2], paddingHorizontal: theme.space[3], paddingTop: theme.space[2], backgroundColor: theme.colors.bg }}>
      {problem ? <InlineNote>{problem}</InlineNote> : null}
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <Button label="Scan item" icon="scan" size="main" style={styles.grow} onPress={onScan} />
        <Button
          label="Packed"
          variant="secondary"
          size="main"
          style={{ minWidth: theme.control.main * 2 }}
          disabled={pickList.progress.unpicked.length > 0}
          loading={packing}
          onPress={onPacked}
        />
      </View>
    </SafeAreaView>
  );
}

/** The pick list's shape while it loads: the band, then rows of photo, name and pill. */
function PickListSkeleton() {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel="Loading the pick list">
      <Band style={{ gap: theme.space[2] }}>
        <View style={{ height: theme.type.titleNamed.lineHeight }} />
        <View style={{ height: theme.space[2] }} />
      </Band>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={[styles.row, { gap: theme.space[3], padding: theme.space[4] }]}>
          <Skeleton width={theme.control.md} height={theme.control.md} radius="md" />
          <View style={[styles.grow, { gap: theme.space[2] }]}>
            <Skeleton width="60%" height={theme.space[3]} radius="pill" />
            <Skeleton width="35%" height={theme.space[3]} radius="pill" />
          </View>
          <Skeleton width={theme.control.md} height={theme.space[8]} radius="pill" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  end: { alignSelf: 'flex-end' },
  track: { flex: 1, overflow: 'hidden' },
});
