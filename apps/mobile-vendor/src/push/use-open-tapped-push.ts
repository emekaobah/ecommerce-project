import { pushTarget } from '@oja/domain';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { orderKeys } from '@/api/orders';
import { queryClient } from '@/api/query-client';
import { getSession } from '@/session/session-store';

import { actForShop } from './act-for-shop';
import { openTakeover } from './new-order-takeover';

/** Opens the order a tapped push is about, acting for its shop first when the member is in several. */
async function open(response: Notifications.NotificationResponse) {
  // A push tapped while signed out waits for sign-in (this layout mounts only for a session).
  const session = getSession();
  if (!session) return;
  // Handled once, never again on a later mount.
  Notifications.clearLastNotificationResponse();
  const target = pushTarget(response.notification.request.content.data);
  if (!target) return;
  if (!(await actForShop(target.sellerId))) return;
  router.push(target.path as Href);
}

/** Refreshes the orders for a push arriving while the app is open; a new order may take over the screen. */
function received(notification: Notifications.Notification) {
  void queryClient.invalidateQueries({ queryKey: orderKeys.all });
  void openTakeover(notification);
}

/**
 * Tapping a push opens its order (#27), whether the app was running or the tap launched it. A
 * push arriving while the app is open refreshes the orders, so a new order shows at once, and a
 * new order's push opens the full-screen takeover unless this phone is set to banners (#83).
 */
export function useOpenTappedPush(): void {
  useEffect(() => {
    const launchedBy = Notifications.getLastNotificationResponse();
    if (launchedBy) void open(launchedBy);
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => void open(response));
    const arrived = Notifications.addNotificationReceivedListener(received);
    return () => {
      tapped.remove();
      arrived.remove();
    };
  }, []);
}
