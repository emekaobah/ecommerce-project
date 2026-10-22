import { Button, Text, useTheme } from '@oja/ui';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { useMayManageShop } from '@/api/sellers';
import { useSession } from '@/session/session-store';

/**
 * Every item of the order is unavailable (#17): nothing is left to pack, so rather than removing
 * the items the order is cancelled, which refunds the buyer in full. Owners and managers get the
 * cancel flow, with the reason picked; fulfilment staff are told to ask one of them.
 */
export function CancelInstead({ orderId }: Readonly<{ orderId: string }>) {
  const theme = useTheme();
  const router = useRouter();
  const mayManage = useMayManageShop(useSession()?.sellerId);

  return (
    <View style={{ gap: theme.space[2] }}>
      <Text>Every item is unavailable, so there is nothing to pack. Cancel the order to refund the buyer in full.</Text>
      {mayManage.data ? (
        <Button
          label="Cancel order"
          onPress={() =>
            router.push({ pathname: '/orders/[id]/cancel', params: { id: orderId, reason: 'items_unavailable' } })
          }
        />
      ) : (
        <Text tone="muted">{"Ask the shop's owner or a manager to cancel it."}</Text>
      )}
    </View>
  );
}
