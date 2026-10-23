import { pushTokenSource } from '@oja/expo-push';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { shownInApp } from './new-order-takeover';

/**
 * This device's Expo push token, or null where pushes can't arrive (see `pushTokenSource`). A
 * new order arriving while the app is open shows as the takeover instead of a banner (#83).
 */
export const devicePushToken = pushTokenSource(
  { Constants, Device, Notifications, Platform },
  { shownInApp: (notification) => shownInApp(notification.request.content.data) }
);
