import { NEW_ORDER_ALARM } from '@oja/domain';
import { AndroidImportance, AndroidNotificationVisibility, setNotificationChannelAsync } from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Creates the Android channel a new order's push arrives on (#71): the highest importance, so it
 * pops up over other apps, playing Oja's alarm. Android fixes a channel's sound and importance
 * when it is first created, so these only change under a new channel id. Asked at start-up, before
 * any push can arrive; creating it again is harmless. iOS has no channels: the push names the sound.
 */
export async function createNewOrderChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await setNotificationChannelAsync(NEW_ORDER_ALARM.channelId, {
    name: NEW_ORDER_ALARM.channelName,
    importance: AndroidImportance.MAX,
    sound: NEW_ORDER_ALARM.sound,
    vibrationPattern: [0, 500, 250, 500, 250, 500],
    lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
    // Rings through Do Not Disturb where the member has let the app do so.
    bypassDnd: true,
  });
}
