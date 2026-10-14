import { Button, StatusChip, Text, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { useBookLabel, useOrder } from '@/api/orders';

/**
 * Confirms an order is packed. A delivery order next needs a courier label, which staff can book
 * from here; a pickup order is ready for its buyer to collect (#12), and its buyer is told.
 */
export function PackedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const bookLabel = useBookLabel(id);
  const pickup = order.data?.fulfilment.method === 'pickup';
  const name = order.data ? `Order #${order.data.display_id}` : 'The order';

  if (pickup) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: theme.space.lg, gap: theme.space.md }}>
        <Stack.Screen options={{ title: 'Ready for pickup' }} />
        <StatusChip label="Ready for pickup" tone="success" />
        <Text variant="title">{`${name} is ready for pickup`}</Text>
        <Text tone="secondary">
          {"Keep it at the counter. We've told the buyer; they collect it with the code in their app."}
        </Text>
        <Button label="Back to orders" onPress={() => router.dismissTo('/')} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: theme.space.lg, gap: theme.space.md }}>
      <Stack.Screen options={{ title: 'Packed' }} />
      <StatusChip label="Packed" tone="success" />
      <Text variant="title">{`${name} is packed`}</Text>
      <Text tone="secondary">Keep it at the counter, and book a courier to collect it.</Text>
      {bookLabel.error ? <Text tone="danger">{bookLabel.error.message}</Text> : null}
      <Button
        label="Book courier label"
        loading={bookLabel.isPending}
        onPress={() => bookLabel.mutate(undefined, { onSuccess: () => router.back() })}
      />
      <Button label="Back to orders" variant="secondary" disabled={bookLabel.isPending} onPress={() => router.dismissTo('/')} />
    </View>
  );
}
