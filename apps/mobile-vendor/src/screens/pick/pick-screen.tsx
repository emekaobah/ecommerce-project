import { Button, EmptyState, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { usePackOrder, usePickList, useRecordPick, type PickListLine } from '@/api/orders';

import { PickMark } from './pick-mark';

/**
 * The picking checklist: tick each line off by hand, or scan its barcode. Packing is open once
 * every line is picked in full.
 */
export function PickScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pickList = usePickList(id);
  const recordPick = useRecordPick(id);
  const pack = usePackOrder(id);

  // A tap picks the whole line, or puts a fully picked line back to none.
  const toggle = (line: PickListLine) =>
    recordPick.mutate({ itemId: line.id, picked: line.picked >= line.quantity ? 0 : line.quantity });

  const content = () => {
    if (pickList.error && !pickList.data) {
      return (
        <ErrorState title="Couldn't load the pick list" message={pickList.error.message} onRetry={() => void pickList.refetch()} />
      );
    }
    if (!pickList.data) return <LoadingState />;
    const { lines, progress } = pickList.data;
    if (!lines.length) return <EmptyState title="Nothing to pick" message="This order has no items." />;

    return (
      <ScrollView contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg }}>
        <Text variant="heading" accessibilityLiveRegion="polite">
          {progress.picked} of {progress.total} picked
        </Text>

        <View>
          {lines.map((line) => (
            <ListRow
              key={line.id}
              title={line.product_title ?? 'Item'}
              subtitle={subtitle(line)}
              trailing={<PickMark picked={line.picked} quantity={line.quantity} />}
              onPress={() => toggle(line)}
            />
          ))}
        </View>

        <View style={{ gap: theme.space.sm }}>
          {recordPick.error ? <Text tone="danger">{recordPick.error.message}</Text> : null}
          {pack.error ? <Text tone="danger">{pack.error.message}</Text> : null}
          <Button
            label="Scan barcodes"
            variant="secondary"
            onPress={() => router.push({ pathname: '/orders/[id]/scan', params: { id } })}
          />
          <Button
            label="Mark packed"
            disabled={!progress.done || recordPick.isPending}
            loading={pack.isPending}
            onPress={() =>
              pack.mutate(undefined, {
                onSuccess: () => router.replace({ pathname: '/orders/[id]/packed', params: { id } }),
              })
            }
          />
          {progress.done ? null : <Text tone="secondary">Pick every item to pack the order.</Text>}
        </View>
      </ScrollView>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Pick items' }} />
      {content()}
    </>
  );
}

function subtitle(line: PickListLine) {
  const parts = [
    line.variant_title && line.variant_title !== line.product_title ? line.variant_title : null,
    `${line.picked} of ${line.quantity} picked`,
    line.codes.length ? null : 'No barcode: tick by hand',
  ];
  return parts.filter(Boolean).join(' · ');
}
