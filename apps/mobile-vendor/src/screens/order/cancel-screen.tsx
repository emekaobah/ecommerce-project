import {
  buyerShortName,
  CANCEL_REASON_CHOICES,
  CANCEL_REASONS,
  cancelRefundNote,
  cancelRequest,
  formatMoney,
  staffStatus,
  type CancelReason,
} from '@oja/domain';
import { Band, Button, EmptyState, ErrorState, InlineNote, RadioOption, Skeleton, StatusChip, Text, TextField, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { refusedWith } from '@/api/errors';
import { useCancelOrder, useCancelPreview, useOrder } from '@/api/orders';

import { ConfirmationHero } from '../collect/confirmation-hero';

const isReason = (value: string | undefined): value is CancelReason => (CANCEL_REASONS as readonly (string | undefined)[]).includes(value);

/**
 * Cancels an accepted order (#17, catalogue v-shop #7), for owners and managers: one of four
 * reasons the buyer reads, a note (required for Other, optional otherwise), and the refund it
 * makes, all that is left of what the buyer paid, said before the button and in it. Opened with
 * a `reason` to start from it, as the pick list does once every item is unavailable.
 */
export function CancelScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; reason?: string }>();
  const { id } = params;
  const order = useOrder(id);
  const preview = useCancelPreview(id);
  const cancel = useCancelOrder(id);
  // The view measures itself below the header: without its height the keyboard covers the foot button.
  const headerHeight = useHeaderHeight();
  const [reason, setReason] = useState<CancelReason | null>(isReason(params.reason) ? params.reason : null);
  const [note, setNote] = useState('');
  const request = cancelRequest({ reason, note });
  const title = order.data ? `Order #${order.data.display_id}` : 'Cancel order';

  const content = () => {
    if (cancel.data) {
      const { refund, refund_amount } = cancel.data;
      return (
        <Cancelled
          amount={formatMoney(refund_amount, preview.data?.currency_code ?? '')}
          refunded={refund !== null}
          nothingLeft={refund_amount === 0}
          onDone={() => router.dismissTo('/')}
        />
      );
    }
    if (preview.error && !preview.data) {
      return (
        <ErrorState
          title="Couldn't load the order"
          body="Check your connection and try again. Nothing has been cancelled."
          error={preview.error}
          onRetry={() => void preview.refetch()}
        />
      );
    }
    if (!preview.data) return <CancelSkeleton />;
    if (!preview.data.allowed) {
      return (
        <EmptyState
          title="This order can't be cancelled now"
          body="Only an accepted order can be cancelled, up until its courier label is booked."
        />
      );
    }
    const refund = formatMoney(preview.data.refund_amount, preview.data.currency_code);
    const buyer = order.data ? buyerShortName(order.data) : null;
    // An order already refunded in full (or never paid) has nothing left to refund.
    const refunds = preview.data.refund_amount > 0;

    return (
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerHeight}>
        <ScrollView contentContainerStyle={{ paddingBottom: theme.space[6] }} keyboardShouldPersistTaps="handled">
          <CancelBand state={order.data?.fulfilment.state} />
          <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
            <View accessibilityRole="radiogroup" accessibilityLabel="Reason the buyer will see" style={{ gap: theme.space[2] }}>
              <Text variant="meta" weight="bold" tone="muted">
                Reason the buyer will see
              </Text>
              {CANCEL_REASONS.map((option) => (
                <RadioOption key={option} selected={reason === option} onPress={() => setReason(option)}>
                  <Text>{CANCEL_REASON_CHOICES[option]}</Text>
                </RadioOption>
              ))}
            </View>
            {reason ? (
              <TextField
                label={reason === 'other' ? 'Why are you cancelling?' : 'Note for the buyer'}
                optional={reason !== 'other'}
                hint={reason === 'other' ? 'The buyer reads this.' : null}
                testID="cancel-note"
                multiline
                maxLength={500}
                value={note}
                onChangeText={setNote}
              />
            ) : null}
            <InlineNote>
              <Text variant="meta" weight="bold" style={{ color: theme.status.attention.foreground }}>
                {refunds ? cancelRefundNote(buyer, refund) : 'Nothing is left to refund on the order.'}
              </Text>
              {" Stock goes back to your shelves. This can't be undone."}
            </InlineNote>
          </View>
        </ScrollView>
        <SafeAreaView
          edges={['bottom']}
          style={{ paddingHorizontal: theme.space[3], paddingTop: theme.space[2], gap: theme.space[2], backgroundColor: theme.colors.bg }}>
          {cancel.error ? (
            <InlineNote>
              {refusedWith(cancel.error, [400, 403, 409]) ?? "Couldn't cancel the order. Check your connection and try again; nothing has changed."}
            </InlineNote>
          ) : null}
          <Button
            label={refunds ? `Cancel and refund ${refund}` : 'Cancel order'}
            variant="danger"
            size="main"
            disabled={!request}
            loading={cancel.isPending}
            onPress={() => request && cancel.mutate(request)}
          />
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  };

  return (
    <>
      {/* Once cancelled, the confirmation runs up under the status bar. */}
      <Stack.Screen options={{ title, headerShown: !cancel.data, headerBackButtonDisplayMode: 'minimal' }} />
      {content()}
    </>
  );
}

/** The band: where the order is now, and what this screen does. */
function CancelBand({ state }: Readonly<{ state: Parameters<typeof staffStatus>[0] | undefined }>) {
  const theme = useTheme();
  return (
    <Band style={{ gap: theme.space[2] }}>
      {state ? (
        <View style={styles.start}>
          <StatusChip {...staffStatus(state)} onBand />
        </View>
      ) : null}
      <Text variant="titleNamed" tone="onBand">
        Cancel this order
      </Text>
    </Band>
  );
}

/** The band and the four reasons while the preview loads. */
function CancelSkeleton() {
  const theme = useTheme();
  return (
    <View>
      <CancelBand state={undefined} />
      <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
        {CANCEL_REASONS.map((reason) => (
          <Skeleton key={reason} height={theme.hitArea} radius="md" />
        ))}
      </View>
    </View>
  );
}

/**
 * Cancelled: the indigo confirmation and where its refund is. One Paystack turned down is still
 * owed, and retried: pending, not failed.
 */
function Cancelled({
  amount,
  refunded,
  nothingLeft,
  onDone,
}: Readonly<{ amount: string; refunded: boolean; nothingLeft: boolean; onDone: () => void }>) {
  const theme = useTheme();
  let line = `The refund of ${amount} didn't go through yet. Oja keeps trying it, and the buyer is told.`;
  if (nothingLeft) line = 'The buyer had already been refunded in full.';
  else if (refunded) line = `${amount} is being refunded to the buyer.`;
  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={{ paddingBottom: theme.space[6] }}>
        <ConfirmationHero title="Order cancelled" line={line} />
        {nothingLeft ? null : (
          <View style={[styles.start, { padding: theme.space[4] }]}>
            <StatusChip
              label={refunded ? 'Refund on its way' : 'Refund pending'}
              tone={refunded ? 'success' : 'new'}
              icon={refunded ? 'check' : 'clock'}
            />
          </View>
        )}
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: theme.space[3], paddingTop: theme.space[2] }}>
        <Button label="Back to orders" size="main" onPress={onDone} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  start: { alignItems: 'flex-start' },
});
