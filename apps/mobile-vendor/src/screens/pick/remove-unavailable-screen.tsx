import { formatMoney } from '@oja/domain';
import { Button, ErrorState, InlineNote, QuantityPill, Skeleton, StatusChip, Text, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { refusedWith } from '@/api/errors';
import { isCancelInstead, usePickList, useRemoveUnavailable } from '@/api/orders';

import { CancelInstead } from './cancel-instead';
import { LinePhoto } from './line-photo';

/**
 * The refund summary (catalogue v-pick #4, #22): the items marked short and what the buyer gets
 * back, then, once staff confirm, the order edited and the refund made (Items removed, v-pick
 * #5). The order goes back to picking. When every item is short there is nothing left to send:
 * the order is cancelled instead (#17).
 */
export function RemoveUnavailableScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pickList = usePickList(id);
  const remove = useRemoveUnavailable(id);
  // Back to the pick list it came from, or to a fresh one when the summary was opened on its own.
  const toPicking = () => router.dismissTo({ pathname: '/orders/[id]/pick', params: { id } });

  if (remove.data) {
    const { refund, removed_amount, pick_list } = remove.data;
    const currency = pick_list.currency_code;
    return (
      <Layout
        title="Items removed"
        done
        foot={<Button label="Back to picking" size="main" onPress={toPicking} />}>
        {refund ? (
          <>
            <StatusChip label="Refund on its way" tone="success" icon="check" />
            <Text>{`${formatMoney(refund.amount, currency)} is being refunded to the buyer.`}</Text>
          </>
        ) : (
          <>
            <StatusChip label="Refund not made" tone="attention" icon="info" />
            <Text>
              {`The order was changed, but the refund of ${formatMoney(removed_amount, currency)} didn't go through. Contact Oja support to finish it.`}
            </Text>
          </>
        )}
      </Layout>
    );
  }

  if (pickList.error && !pickList.data) {
    return (
      <>
        <Stack.Screen options={{ title: 'Refund to the buyer' }} />
        <ErrorState
          title="Couldn't load the pick list"
          body="Check your connection and try again. Nothing you've picked is lost."
          error={pickList.error}
          onRetry={() => void pickList.refetch()}
        />
      </>
    );
  }
  if (!pickList.data) {
    return (
      <Layout title="Refund to the buyer">
        <View accessible accessibilityLabel="Loading the refund" style={{ gap: theme.space[4] }}>
          <Skeleton height={theme.space[12]} />
          <Skeleton height={theme.control.md} radius="md" />
        </View>
      </Layout>
    );
  }

  const { lines, progress, unavailable_amount, currency_code } = pickList.data;
  const marked = lines.filter((line) => line.unavailable > 0);
  const amount = formatMoney(unavailable_amount, currency_code);
  // The pick list says so first; the API refuses removing every item too, should it change meanwhile.
  const cancelInstead = progress.allUnavailable || isCancelInstead(remove.error);

  const foot = cancelInstead ? (
    <CancelInstead orderId={id} />
  ) : (
    <>
      {remove.error ? (
        <InlineNote>
          {refusedWith(remove.error, [400, 409]) ?? "Couldn't remove the items. Check your connection and try again."}
        </InlineNote>
      ) : null}
      <Button
        label="Remove and refund"
        variant="danger"
        size="main"
        detail={amount}
        disabled={!marked.length}
        loading={remove.isPending}
        onPress={() => remove.mutate()}
      />
      <Button label="Keep picking" variant="secondary" size="main" disabled={remove.isPending} onPress={toPicking} />
    </>
  );

  return (
    <Layout title="Refund to the buyer" foot={foot}>
      <Text tone="muted" style={{ lineHeight: theme.type.body.fontSize * 1.5 }}>
        These come off the order, and the buyer is refunded what they paid for them. You then pick and pack the rest.
      </Text>
      {marked.map((line) => (
        <View
          key={line.id}
          accessible
          accessibilityLabel={`${line.product_title ?? 'Item'}, ${line.unavailable} of ${line.quantity} unavailable`}
          style={[styles.row, { gap: theme.space[3] }]}>
          <LinePhoto uri={line.thumbnail} />
          <View style={styles.grow}>
            <Text weight="bold">{line.product_title ?? 'Item'}</Text>
            <Text variant="meta" tone="muted">{`${line.unavailable} of ${line.quantity} unavailable`}</Text>
          </View>
          <QuantityPill label={`${line.unavailable}/${line.quantity}`} tone="short" />
        </View>
      ))}
      <View style={[styles.row, styles.spread, { gap: theme.space[2] }]}>
        <Text variant="strong" style={styles.grow}>
          Refund to the buyer
        </Text>
        <Text variant="heading" tabular>
          {amount}
        </Text>
      </View>
    </Layout>
  );
}

/**
 * The screen's frame: its title in the bar, content from the top, actions at the foot. Once the
 * items are removed (`done`) there is no going back to the summary, only Back to picking.
 */
function Layout({ title, done = false, foot, children }: Readonly<{ title: string; done?: boolean; foot?: ReactNode; children: ReactNode }>) {
  const theme = useTheme();
  return (
    <>
      <Stack.Screen options={{ title, headerBackVisible: !done, gestureEnabled: !done }} />
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }}>{children}</ScrollView>
      {foot ? (
        <SafeAreaView edges={['bottom']} style={{ gap: theme.space[2], paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }}>
          <>{foot}</>
        </SafeAreaView>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  spread: { justifyContent: 'space-between' },
  grow: { flex: 1 },
});
