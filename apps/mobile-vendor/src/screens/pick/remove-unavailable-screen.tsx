import { formatMoney } from '@oja/domain';
import { Button, ErrorState, ListRow, LoadingState, StatusChip, Text, useTheme } from '@oja/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { isCancelInstead, usePickList, useRemoveUnavailable } from '@/api/orders';

import { CancelInstead } from './cancel-instead';

/**
 * The refund summary (#22): the items marked unavailable and what the buyer gets back, then,
 * once staff confirm, the order edited and the refund made. The order goes back to picking.
 * When every item is unavailable there is nothing left to send: the order is cancelled instead (#17).
 */
export function RemoveUnavailableScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pickList = usePickList(id);
  const remove = useRemoveUnavailable(id);
  const done = remove.data;

  if (done) {
    const currency = done.pick_list.currency_code;
    return (
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6] }}>
        <Text variant="titlePushed">Items removed</Text>
        {done.refund ? (
          <View style={{ gap: theme.space[1] }}>
            <StatusChip label="Refund on its way" tone="success" icon="check" />
            <Text>{`${formatMoney(done.refund.amount, currency)} is being refunded to the buyer.`}</Text>
          </View>
        ) : (
          <View style={{ gap: theme.space[1] }}>
            <StatusChip label="Refund not made" tone="new" icon="clock" />
            <Text>
              {`The order was changed, but the refund of ${formatMoney(done.removed_amount, currency)} didn't go through. Contact Oja support to finish it.`}
            </Text>
          </View>
        )}
        <Button label="Back to picking" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  if (pickList.error && !pickList.data) {
    return <ErrorState title="Couldn't load the pick list" body="Check your connection and try again. Nothing you've picked is lost." error={pickList.error} onRetry={() => void pickList.refetch()} />;
  }
  if (!pickList.data) return <LoadingState />;
  const { lines, progress, unavailable_amount, currency_code } = pickList.data;
  const marked = lines.filter((line) => line.unavailable > 0);
  // The pick list says so first; the API refuses removing every item too, should it change meanwhile.
  const cancelInstead = progress.allUnavailable || isCancelInstead(remove.error);

  return (
    <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6] }}>
      <Text tone="muted">
        These come off the order, and the buyer is refunded what they paid for them. You then pick and pack the rest.
      </Text>
      <View>
        {marked.map((line) => (
          <ListRow
            key={line.id}
            title={line.product_title ?? 'Item'}
            subtitle={`${line.unavailable} of ${line.quantity} unavailable`}
          />
        ))}
      </View>
      <View style={styles.spread}>
        <Text variant="strong">Refund to the buyer</Text>
        <Text variant="strong">{formatMoney(unavailable_amount, currency_code)}</Text>
      </View>
      {cancelInstead ? (
        <CancelInstead orderId={id} />
      ) : (
        <>
          {remove.error ? <Text tone="danger">{remove.error.message}</Text> : null}
          <Button
            label="Remove and refund"
            detail={formatMoney(unavailable_amount, currency_code)}
            disabled={!marked.length}
            loading={remove.isPending}
            onPress={() => remove.mutate()}
          />
        </>
      )}
      <Button label="Keep picking" variant="secondary" disabled={remove.isPending} onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
