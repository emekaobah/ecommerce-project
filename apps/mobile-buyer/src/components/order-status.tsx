import { formatMoney, orderStatus, owedRefundStatus, refundStatus, type StatusChipView } from '@oja/domain';
import { Button, StatusChip, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { SellerOrder } from '@/api/orders';

/** When a checkout was paid for, to the minute: payments made close together read apart (#65). */
export function orderedAt(createdAt: string) {
  return new Date(createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A shop's order's state, its refund once it has one, and a refund it still owes (#16), as chips. */
export function orderChips(order: SellerOrder): StatusChipView[] {
  return [orderStatus(order), refundStatus(order.refund), owedRefundStatus(order.owed_refund, order.currency_code)]
    .filter((view) => view !== null)
    .map(({ label, tone, icon }) => ({ label, tone, icon }));
}

/** A shop's order's chips, in a wrapping row. */
export function OrderStatusChips({ order }: Readonly<{ order: SellerOrder }>) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { gap: theme.space[2] }]}>
      {orderChips(order).map((chip) => (
        <StatusChip key={chip.label} label={chip.label} tone={chip.tone} icon={chip.icon} />
      ))}
    </View>
  );
}

/** A shop's order's state and refund, with why it was rejected, where the refund is, and what is still owed. */
export function OrderStatusDetails({ order }: Readonly<{ order: SellerOrder }>) {
  const theme = useTheme();
  const status = orderStatus(order);
  const refund = refundStatus(order.refund);
  const owed = owedRefundStatus(order.owed_refund, order.currency_code);
  return (
    <View style={{ gap: theme.space[1] }}>
      <OrderStatusChips order={order} />
      {status.note ? <Text tone="muted">{`Reason: ${status.note}`}</Text> : null}
      {refund && order.refund ? (
        <Text tone="muted">
          {[`${formatMoney(order.refund.amount, order.currency_code)} back to you.`, refund.note].filter(Boolean).join(' ')}
        </Text>
      ) : null}
      {owed?.note ? <Text tone="muted">{`${owed.note}.`}</Text> : null}
      {order.refund_needing_account ? (
        <Button
          label="Add a bank account"
          variant="secondary"
          onPress={() => router.push(`/refund/${order.refund_needing_account}`)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
