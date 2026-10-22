import { formatMoney } from '@oja/domain';
import { Button, Sheet, Text, TextField } from '@oja/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { orderValue, useOrder, useRejectOrder } from '@/api/orders';

/**
 * Why staff can't take a new order, in words the buyer reads, with the refund it makes stated
 * before the red button: the buyer is refunded all they paid for it.
 */
export function RejectSheet() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const reject = useRejectOrder(id);
  const [reason, setReason] = useState('');
  const canReject = reason.trim() !== '';

  const submit = () => reject.mutate(reason.trim(), { onSuccess: () => router.back() });

  return (
    <Sheet
      title="Why can't you take it?"
      message={refundMessage(order.data)}
      actions={
        <>
          {reject.error ? (
            // TODO(#79): use @oja/ui InlineNote.
            <Text tone="ember" accessibilityRole="alert" accessibilityLiveRegion="polite">
              {"Couldn't reject the order. Check your connection and try again; it's still waiting."}
            </Text>
          ) : null}
          <Button
            label="Reject and refund"
            variant="danger"
            size="main"
            onPress={submit}
            disabled={!canReject}
            loading={reject.isPending}
          />
        </>
      }>
      <TextField
        label="Reason"
        testID="reject-reason"
        multiline
        maxLength={500}
        value={reason}
        onChangeText={setReason}
      />
    </Sheet>
  );
}

/** "Tolu sees this reason and is refunded all ₦32,500, delivery included." */
function refundMessage(order: ReturnType<typeof useOrder>['data']): string {
  const buyer = order?.billing_address?.first_name?.trim() || 'The buyer';
  if (!order) return `${buyer} sees this reason and is refunded in full.`;
  const delivery = order.fulfilment.method === 'delivery' ? ', delivery included' : '';
  return `${buyer} sees this reason and is refunded all ${formatMoney(orderValue(order), order.currency_code)}${delivery}.`;
}
