import { CANCEL_REASON_LABELS, CANCEL_REASONS, cancelRequest, formatMoney, type CancelReason } from '@oja/domain';
import { Button, EmptyState, ErrorState, line, LoadingState, MAX_FONT_SCALE, RadioOption, StatusChip, Text, useTheme } from '@oja/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { useCancelOrder, useCancelPreview } from '@/api/orders';

const isReason = (value: string | undefined): value is CancelReason => (CANCEL_REASONS as readonly (string | undefined)[]).includes(value);

/**
 * Cancels an accepted order (#17), for owners and managers: why (the buyer is told), then the
 * refund it makes, which is all that is left of what the buyer paid for it. Opened with a
 * `reason` to start from it, as the pick list does once every item is unavailable.
 */
export function CancelScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; reason?: string }>();
  const { id } = params;
  const preview = useCancelPreview(id);
  const cancel = useCancelOrder(id);
  const [reason, setReason] = useState<CancelReason | null>(isReason(params.reason) ? params.reason : null);
  const [note, setNote] = useState('');
  const request = cancelRequest({ reason, note });

  if (cancel.data) {
    const { refund, refund_amount } = cancel.data;
    const currency = preview.data?.currency_code ?? '';
    return (
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6] }}>
        <StatusChip label="Cancelled" tone="danger" />
        <Text variant="titlePushed">Order cancelled</Text>
        <RefundOutcome amount={formatMoney(refund_amount, currency)} refunded={refund !== null} nothingLeft={refund_amount === 0} />
        <Button label="Back to orders" onPress={() => router.dismissTo('/')} />
      </ScrollView>
    );
  }

  if (preview.error && !preview.data) {
    return <ErrorState title="Couldn't load the order" message={preview.error.message} onRetry={() => void preview.refetch()} />;
  }
  if (!preview.data) return <LoadingState />;
  if (!preview.data.allowed) {
    return (
      <EmptyState
        title="This order can't be cancelled now"
        message="Only an accepted order can be cancelled, up until its courier label is booked."
      />
    );
  }
  const refund = formatMoney(preview.data.refund_amount, preview.data.currency_code);

  return (
    <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6] }} keyboardShouldPersistTaps="handled">
      <Text tone="muted">The buyer is told why, and refunded all they paid for this order.</Text>
      <View accessibilityRole="radiogroup" style={{ gap: theme.space[2] }}>
        {CANCEL_REASONS.map((option) => (
          <RadioOption key={option} selected={reason === option} onPress={() => setReason(option)}>
            <Text variant="strong">{CANCEL_REASON_LABELS[option]}</Text>
          </RadioOption>
        ))}
      </View>
      {reason ? (
        <View style={{ gap: theme.space[1] }}>
          <Text variant="strong">{reason === 'other' ? 'Why are you cancelling?' : 'Add a note for the buyer (optional)'}</Text>
          <TextInput
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            testID="cancel-note"
            style={[
              styles.input,
              theme.type.body,
              {
                color: theme.colors.ink,
                borderColor: theme.colors.control,
                borderRadius: theme.radius.md,
                minHeight: theme.hitArea * 2,
                padding: theme.space[4],
              },
            ]}
            placeholder={reason === 'other' ? 'Required: the buyer reads this' : 'Note'}
            placeholderTextColor={theme.colors.muted}
            multiline
            maxLength={500}
            value={note}
            onChangeText={setNote}
          />
        </View>
      ) : null}
      <View style={styles.spread}>
        <Text variant="strong">Refund to the buyer</Text>
        <Text variant="strong">{refund}</Text>
      </View>
      {cancel.error ? <Text tone="danger">{cancel.error.message}</Text> : null}
      <Button
        label="Cancel and refund"
        detail={refund}
        disabled={!request}
        loading={cancel.isPending}
        onPress={() => request && cancel.mutate(request)}
      />
      <Button label="Keep the order" variant="secondary" disabled={cancel.isPending} onPress={() => router.back()} />
    </ScrollView>
  );
}

/** Where the cancelled order's refund is. One Paystack turned down is still owed, and retried: pending, not failed. */
function RefundOutcome({ amount, refunded, nothingLeft }: Readonly<{ amount: string; refunded: boolean; nothingLeft: boolean }>) {
  const theme = useTheme();
  if (nothingLeft) return <Text>The buyer had already been refunded in full.</Text>;
  return (
    <View style={{ gap: theme.space[1] }}>
      <StatusChip label={refunded ? 'Refund on its way' : 'Refund pending'} tone={refunded ? 'success' : 'warning'} />
      <Text>
        {refunded
          ? `${amount} is being refunded to the buyer.`
          : `The refund of ${amount} didn't go through yet. Oja keeps trying it, and the buyer is told.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: line.input, textAlignVertical: 'top' },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
