import { formatMoney } from '@oja/domain';
import { Button, EmptyState, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { usePackOrder, usePickList, useRecordPick, type PickListLine } from '@/api/orders';

import { PickMark } from './pick-mark';

/**
 * The picking checklist: tick each line off by hand, or scan its barcode. Items the shop
 * doesn't have are marked unavailable, then removed from the order with the buyer refunded
 * (#22). Packing is open once every line left is picked in full.
 */
export function PickScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pickList = usePickList(id);
  const recordPick = useRecordPick(id);
  const pack = usePackOrder(id);

  // A tap picks the whole line (all of it still available), or puts a fully picked line back to none.
  const toggle = (line: PickListLine) => {
    const available = line.quantity - line.unavailable;
    if (available <= 0) return;
    recordPick.mutate({ itemId: line.id, picked: line.picked >= available ? 0 : available });
  };

  const content = () => {
    if (pickList.error && !pickList.data) {
      return (
        <ErrorState title="Couldn't load the pick list" message={pickList.error.message} onRetry={() => void pickList.refetch()} />
      );
    }
    if (!pickList.data) return <LoadingState />;
    const { lines, progress, unavailable_amount, currency_code } = pickList.data;
    if (!lines.length) return <EmptyState title="Nothing to pick" message="This order has no items." />;

    return (
      <ScrollView contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg }}>
        <Text variant="heading" accessibilityLiveRegion="polite">
          {progress.picked} of {progress.total} picked
        </Text>

        <View>
          {lines.map((line) => (
            <View key={line.id}>
              <ListRow
                title={line.product_title ?? 'Item'}
                subtitle={subtitle(line)}
                trailing={<PickMark picked={line.picked} quantity={line.quantity} unavailable={line.unavailable} />}
                onPress={() => toggle(line)}
              />
              {line.picked < line.quantity ? (
                <Button
                  label={line.unavailable ? 'Change unavailable' : 'Mark unavailable'}
                  variant="link"
                  style={{ alignSelf: 'flex-start' }}
                  onPress={() =>
                    router.push({ pathname: '/orders/[id]/unavailable', params: { id, item: line.id } })
                  }
                />
              ) : null}
            </View>
          ))}
        </View>

        {progress.unavailable > 0 ? (
          <View style={{ gap: theme.space.sm }}>
            <Text>
              {`${progress.unavailable} unavailable. Remove ${progress.unavailable === 1 ? 'it' : 'them'} from the order to refund the buyer and pack the rest.`}
            </Text>
            <Button
              label="Remove unavailable items"
              detail={formatMoney(unavailable_amount, currency_code)}
              onPress={() => router.push({ pathname: '/orders/[id]/remove-unavailable', params: { id } })}
            />
          </View>
        ) : null}

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
            variant={progress.unavailable > 0 ? 'secondary' : 'primary'}
            disabled={!progress.done || recordPick.isPending}
            loading={pack.isPending}
            onPress={() =>
              pack.mutate(undefined, {
                onSuccess: () => router.replace({ pathname: '/orders/[id]/packed', params: { id } }),
              })
            }
          />
          {progress.done || progress.unavailable > 0 ? null : (
            <Text tone="secondary">Pick every item, or mark it unavailable, to pack the order.</Text>
          )}
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
