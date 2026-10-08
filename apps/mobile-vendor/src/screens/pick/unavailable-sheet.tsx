import { Button, Text, useTheme } from '@oja/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useMarkUnavailable, usePickList } from '@/api/orders';

/**
 * How many of a line the shop doesn't have (#22): from none up to the units not yet picked.
 * They stay on the order until removed from it, which refunds the buyer.
 */
export function UnavailableSheet() {
  const theme = useTheme();
  const router = useRouter();
  const { id, item } = useLocalSearchParams<{ id: string; item: string }>();
  const line = usePickList(id).data?.lines.find((l) => l.id === item);
  const mark = useMarkUnavailable(id);
  const [count, setCount] = useState<number | null>(null);

  if (!line) return null;
  const most = line.quantity - line.picked;
  const quantity = count ?? Math.max(line.unavailable, 1);

  return (
    <View style={{ padding: theme.space.lg, gap: theme.space.md }}>
      <Text variant="title">Mark unavailable</Text>
      <Text tone="secondary">
        {`${line.product_title ?? 'Item'}: ${line.quantity} ordered, ${line.picked} picked. The buyer is refunded for what you can't send.`}
      </Text>
      <View style={[styles.stepper, { gap: theme.space.md }]}>
        <Button
          label="−"
          variant="secondary"
          style={styles.step}
          disabled={quantity <= 0}
          onPress={() => setCount(Math.max(quantity - 1, 0))}
        />
        <Text variant="title" accessibilityLiveRegion="polite" accessibilityLabel={`${quantity} unavailable`}>
          {quantity}
        </Text>
        <Button
          label="+"
          variant="secondary"
          style={styles.step}
          disabled={quantity >= most}
          onPress={() => setCount(Math.min(quantity + 1, most))}
        />
      </View>
      {mark.error ? <Text tone="danger">{mark.error.message}</Text> : null}
      <Button
        label={quantity === 0 ? 'Clear unavailable' : `Mark ${quantity} unavailable`}
        loading={mark.isPending}
        disabled={quantity === line.unavailable}
        onPress={() => mark.mutate({ itemId: line.id, quantity }, { onSuccess: () => router.back() })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  step: { width: 64 },
});
