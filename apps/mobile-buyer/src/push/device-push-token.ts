import { pushTokenSource } from '@oja/expo-push';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** This device's Expo push token, or null where pushes can't arrive (see `pushTokenSource`). */
export const devicePushToken = pushTokenSource({ Constants, Device, Notifications, Platform });
