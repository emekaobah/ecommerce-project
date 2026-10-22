import { Button, line, MAX_FONT_SCALE, Text, useTheme } from '@oja/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useRejectOrder } from '@/api/orders';

const COMMON_REASONS = ['Out of stock', "Can't prepare it in time", 'Shop is closed'];

/** Why staff reject an order; the buyer is told and refunded. */
export function RejectSheet() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const reject = useRejectOrder(id);
  const [reason, setReason] = useState('');
  const canReject = reason.trim() !== '';

  const submit = () =>
    reject.mutate(reason.trim(), {
      onSuccess: () => router.back(),
    });

  return (
    <View style={{ padding: theme.space[6], gap: theme.space[4] }}>
      <Text variant="titlePushed">Reject order</Text>
      <Text tone="muted">The buyer is told why and refunded in full.</Text>
      <View style={[styles.reasons, { gap: theme.space[2] }]}>
        {COMMON_REASONS.map((common) => (
          <Button key={common} label={common} variant="secondary" onPress={() => setReason(common)} />
        ))}
      </View>
      <TextInput
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        testID="reject-reason"
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
        placeholder="Reason"
        placeholderTextColor={theme.colors.muted}
        multiline
        maxLength={500}
        value={reason}
        onChangeText={setReason}
      />
      {reject.error ? <Text tone="danger">{reject.error.message}</Text> : null}
      <Button label="Reject order" onPress={submit} disabled={!canReject} loading={reject.isPending} />
    </View>
  );
}

const styles = StyleSheet.create({
  reasons: { flexDirection: 'row', flexWrap: 'wrap' },
  input: { borderWidth: line.input, textAlignVertical: 'top' },
});
