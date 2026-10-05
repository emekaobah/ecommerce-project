import { Button, StatusChip, Text, useTheme } from '@oja/ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { useOrder } from '@/api/orders';

/** Confirms an order is packed; next it needs a courier label. */
export function PackedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: theme.space.lg, gap: theme.space.md }}>
      <Stack.Screen options={{ title: 'Packed' }} />
      <StatusChip label="Packed" tone="success" />
      <Text variant="title">{order.data ? `Order #${order.data.display_id} is packed` : 'Order packed'}</Text>
      <Text tone="secondary">Keep it at the counter, ready for a courier label.</Text>
      <Button label="Back to orders" onPress={() => router.dismissTo('/')} />
    </View>
  );
}
