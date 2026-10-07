import { pushTarget } from '@oja/domain';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

function open(response: Notifications.NotificationResponse) {
  // Handled once, never again on a later mount.
  Notifications.clearLastNotificationResponse();
  const target = pushTarget(response.notification.request.content.data);
  // A screen that needs a signed-in buyer redirects a guest to sign in.
  if (target) router.push(target.path as Href);
}

/**
 * Tapping a push opens the screen it is about (#27), whether the app was running or the tap
 * launched it. `ready` once the navigator renders (Clerk has restored the session).
 */
export function useOpenTappedPush(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const launchedBy = Notifications.getLastNotificationResponse();
    if (launchedBy) open(launchedBy);
    const tapped = Notifications.addNotificationResponseReceivedListener(open);
    return () => tapped.remove();
  }, [ready]);
}
