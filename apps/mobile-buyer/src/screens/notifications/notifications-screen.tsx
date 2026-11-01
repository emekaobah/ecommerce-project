import { useAuth } from '@clerk/expo';
import { ErrorState, InlineNote, LoadingState, SwitchRow, Text, useTheme } from '@oja/ui';
import { ScrollView, View } from 'react-native';

import { useChangeNotificationPreference, useNotificationPreferences } from '@/api/notification-preferences';
import { liveActivityTokens } from '@/live-activity/register';

/**
 * The buyer's notification settings (#138), from Account: Orders on Lock Screen (#145), where the
 * phone can show them, and Cart reminders by push and by email, all on until the buyer turns one
 * off. They're kept on the server, so they hold on any phone the buyer signs in on. A switch that
 * doesn't save flips back and says so. Order notifications have no setting: they always arrive.
 */
export function NotificationsScreen() {
  const theme = useTheme();
  const { userId } = useAuth();
  const preferences = useNotificationPreferences(userId);
  const change = useChangeNotificationPreference(userId);

  if (preferences.error && !preferences.data) {
    return (
      <ErrorState
        title="Couldn't load your notification settings"
        body="Check your connection and try again."
        error={preferences.error}
        onRetry={() => void preferences.refetch()}
      />
    );
  }
  if (!preferences.data) return <LoadingState />;

  const settings = preferences.data;
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[6], paddingBottom: theme.space[8] }}>
      {liveActivityTokens.available ? (
        <View style={{ paddingBottom: theme.space[6] }}>
          <SwitchRow
            label="Orders on Lock Screen"
            description="Follow each shop's order on your Lock Screen. Order notifications still arrive."
            value={settings.orders_on_lock_screen}
            onValueChange={(on) => change.mutate({ orders_on_lock_screen: on })}
          />
        </View>
      ) : null}
      <View style={{ gap: theme.space[1], paddingBottom: theme.space[3] }}>
        <Text variant="heading">Cart reminders</Text>
        <Text variant="meta" tone="muted">
          A reminder when you leave items in your cart without paying.
        </Text>
      </View>
      <SwitchRow
        label="Push notifications"
        value={settings.cart_reminder_push}
        onValueChange={(on) => change.mutate({ cart_reminder_push: on })}
      />
      <SwitchRow label="Email" value={settings.cart_reminder_email} onValueChange={(on) => change.mutate({ cart_reminder_email: on })} />
      {change.isError ? <InlineNote>{"Couldn't save that. Check your connection and try again."}</InlineNote> : null}
    </ScrollView>
  );
}
