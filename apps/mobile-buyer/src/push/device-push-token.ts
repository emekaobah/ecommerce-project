import { pushTokenSource } from '@oja/expo-push';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { NotificationPermission } from './push-consent';

/** This device's Expo push token, or null where pushes can't arrive (see `pushTokenSource`). */
export const devicePushToken = pushTokenSource({ Constants, Device, Notifications, Platform });

/** Whether this build can get a push token: a real phone, built with an EAS project id. */
export function pushesCanArrive(): boolean {
  return Device.isDevice && Boolean(Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId);
}

/** Whether the phone has allowed or denied notifications yet, without asking. */
export async function notificationPermission(): Promise<NotificationPermission> {
  return (await Notifications.getPermissionsAsync()).status as NotificationPermission;
}
