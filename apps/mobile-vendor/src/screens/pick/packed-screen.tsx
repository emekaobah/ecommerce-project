import { Button, StatusChip, Text, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { useBookLabel, useOrder } from '@/api/orders';

/** Confirms an order is packed; next it needs a courier label, which staff can book from here. */
export function PackedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const bookLabel = useBookLabel(id);

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: theme.space.lg, gap: theme.space.md }}>
      <Stack.Screen options={{ title: 'Packed' }} />
      <StatusChip label="Packed" tone="success" />
      <Text variant="title">{order.data ? `Order #${order.data.display_id} is packed` : 'Order packed'}</Text>
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
