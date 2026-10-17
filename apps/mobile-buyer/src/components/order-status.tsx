import { formatMoney, orderStatus, owedRefundStatus, refundStatus } from '@oja/domain';
import { StatusChip, Text, useTheme } from '@oja/ui';
import { StyleSheet, View } from 'react-native';

import type { SellerOrder } from '@/api/orders';

/** When a checkout was paid for, to the minute: payments made close together read apart (#65). */
export function orderedAt(createdAt: string) {
  return new Date(createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A shop's order's state, its refund once it has one, and a refund it still owes (#16). */
export function OrderStatusChips({ order }: Readonly<{ order: SellerOrder }>) {
  const theme = useTheme();
  const status = orderStatus(order);
  const refund = refundStatus(order.refund);
  const owed = owedRefundStatus(order.owed_refund, order.currency_code);
  return (
    <View style={[styles.row, { gap: theme.space.xs }]}>
      <StatusChip label={status.label} tone={status.tone} />
      {refund ? <StatusChip label={refund.label} tone={refund.tone} /> : null}
      {owed ? <StatusChip label={owed.label} tone={owed.tone} /> : null}
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
    <View style={{ gap: theme.space.xs }}>
      <OrderStatusChips order={order} />
      {status.note ? <Text tone="secondary">{`Reason: ${status.note}`}</Text> : null}
      {refund && order.refund ? (
        <Text tone="secondary">
          {[`${formatMoney(order.refund.amount, order.currency_code)} back to you.`, refund.note].filter(Boolean).join(' ')}
        </Text>
      ) : null}
      {owed?.note ? <Text tone="secondary">{`${owed.note}.`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
