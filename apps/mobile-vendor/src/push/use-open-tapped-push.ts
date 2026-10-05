import { pushTarget } from '@oja/domain';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { orderKeys } from '@/api/orders';
import { queryClient } from '@/api/query-client';
import { fetchMemberships, sellerKeys } from '@/api/sellers';
import { vendorClient } from '@/api/client';
import { selectShop } from '@/session/select-shop';
import { getSession } from '@/session/session-store';

/** Opens the order a tapped push is about, acting for its shop first when the member is in several. */
async function open(response: Notifications.NotificationResponse) {
  // Handled once: a push tapped while signed out opens after sign-in, and never again on a later mount.
  Notifications.clearLastNotificationResponse();
  const target = pushTarget(response.notification.request.content.data);
  if (!target) return;
  const session = getSession();
  if (!session) return;
  if (target.sellerId && target.sellerId !== session.sellerId) {
    const memberships = await queryClient.fetchQuery({
      queryKey: sellerKeys.memberships(),
      queryFn: () => fetchMemberships(vendorClient),
    });
    // A shop they've since left: nothing to open.
    if (!memberships.some((m) => m.seller_id === target.sellerId)) return;
    await selectShop(target.sellerId);
  }
  router.push(target.path as Href);
}

/**
 * Tapping a push opens its order (#27), whether the app was running or the tap launched it. A
 * push arriving while the app is open refreshes the orders, so a new order shows at once.
 */
export function useOpenTappedPush(): void {
  useEffect(() => {
    const launchedBy = Notifications.getLastNotificationResponse();
    if (launchedBy) void open(launchedBy);
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => void open(response));
    const received = Notifications.addNotificationReceivedListener(
      () => void queryClient.invalidateQueries({ queryKey: orderKeys.all })
    );
    return () => {
      tapped.remove();
      received.remove();
    };
  }, []);
}
