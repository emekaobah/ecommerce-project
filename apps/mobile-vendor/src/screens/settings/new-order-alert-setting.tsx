import { reportError } from '@oja/expo-sentry';
import { Icon, InlineNote, ListRow, SwitchRow, useTheme } from '@oja/ui';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { setNewOrderAlertMode, useNewOrderAlertMode } from '@/alerts/new-order-alert-store';
import { createNewOrderChannel } from '@/push/new-order-channel';

/**
 * "Full-screen new orders" (catalogue v-shop #4): on, a new order arriving while the app is open
 * takes over the screen; off, it shows as a banner. A setting of this phone, so it takes no shop.
 * A choice the phone couldn't keep flips back and says so. On Android, a way into the system
 * setting that lets the alarm ring through Do Not Disturb.
 */
export function NewOrderAlertSetting() {
  const mode = useNewOrderAlertMode();
  const [notKept, setNotKept] = useState(false);
  const choose = (on: boolean) => {
    setNotKept(false);
    setNewOrderAlertMode(on ? 'takeover' : 'banner').catch((error: unknown) => {
      reportError(error, "Couldn't keep the new-order alert setting");
      setNotKept(true);
    });
  };
  return (
    <>
      <SwitchRow label="Full-screen new orders" description="Off shows a banner instead." value={mode === 'takeover'} onValueChange={choose} />
      {notKept ? <InlineNote>{"Couldn't save that on this phone. Try again."}</InlineNote> : null}
      {Platform.OS === 'android' ? <DoNotDisturbAccess /> : null}
    </>
  );
}

/**
 * Opens Android's Do Not Disturb access list, where the member lets Oja through. Android honours
 * the new-order channel's bypass only for an app with that access when the channel is written,
 * so the channel is written again on coming back. Whether access was given can't be read here.
 */
function DoNotDisturbAccess() {
  const theme = useTheme();
  const visiting = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !visiting.current) return;
      visiting.current = false;
      void createNewOrderChannel();
    });
    return () => subscription.remove();
  }, []);

  return (
    <ListRow
      title="Ring through Do Not Disturb"
      subtitle="Allow it in Android settings"
      trailing={<Icon name="share" color={theme.colors.muted} />}
      onPress={() => {
        visiting.current = true;
        void Linking.sendIntent('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS');
      }}
    />
  );
}
