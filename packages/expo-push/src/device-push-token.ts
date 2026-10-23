import type * as ExpoConstants from 'expo-constants';
import type * as ExpoDevice from 'expo-device';
import type * as ExpoNotifications from 'expo-notifications';
import type { Platform } from 'react-native';

/**
 * The Expo modules the push code calls, passed in by each app rather than imported here, so
 * the app's own copy of each native module is the one used (a workspace package resolves its
 * own copy otherwise).
 */
export type PushModules = {
  Constants: typeof ExpoConstants.default;
  Device: typeof ExpoDevice;
  Notifications: typeof ExpoNotifications;
  Platform: typeof Platform;
};

export type PushOptions = {
  /**
   * Whether the app shows this push itself while it is open (the vendor app's new-order
   * takeover), so the system adds it to the notification list only, with no banner or sound.
   */
  shownInApp?: (notification: ExpoNotifications.Notification) => boolean;
};

/**
 * Shows pushes as banners even while the app is open, except those the app shows itself, and
 * returns a function giving this device's Expo push token, asking for permission first. The
 * token is null where pushes can't arrive: a simulator, a refused permission, or a build without
 * an EAS project id (`EAS_PROJECT_ID`).
 */
export function pushTokenSource({ Constants, Device, Notifications, Platform }: PushModules, { shownInApp }: PushOptions = {}) {
  Notifications.setNotificationHandler({
    handleNotification: (notification) => {
      const inApp = shownInApp?.(notification) ?? false;
      return Promise.resolve({
        shouldPlaySound: !inApp,
        shouldSetBadge: false,
        shouldShowBanner: !inApp,
        shouldShowList: true,
      });
    },
  });

  return async function devicePushToken(): Promise<string | null> {
    if (!Device.isDevice) return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn('No EAS project id: this build gets no push notifications. Set EAS_PROJECT_ID and rebuild.');
      return null;
    }
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Orders',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const { granted } = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!granted) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  };
}
