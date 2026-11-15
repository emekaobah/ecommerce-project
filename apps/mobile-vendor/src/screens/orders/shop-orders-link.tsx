import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { actForShop } from '@/push/act-for-shop';

/**
 * Where tapping a shop's Live Activity lands (#146): acts for that shop, when the member is in
 * several, then opens its orders. Draws nothing of its own. A member who has left the shop gets
 * the orders of the shop they're acting for.
 */
export function ShopOrdersLink() {
  const router = useRouter();
  const { sellerId } = useLocalSearchParams<{ sellerId: string }>();
  useEffect(() => {
    void actForShop(sellerId)
      .catch(() => false)
      .finally(() => router.replace('/'));
  }, [router, sellerId]);
  return null;
}
