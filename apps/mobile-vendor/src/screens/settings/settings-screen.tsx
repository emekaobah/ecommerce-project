import { Button, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { Stack, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { useMemberships } from '@/api/sellers';
import { useSession } from '@/session/session-store';
import { signOut } from '@/session/sign-out';

export function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const sellerId = useSession()?.sellerId;
  const memberships = useMemberships();

  const currentShop = () => {
    if (memberships.error && !memberships.data) {
      return (
        <ErrorState
          title="Couldn't load your shops"
          message={memberships.error.message}
          onRetry={() => void memberships.refetch()}
        />
      );
    }
    if (!memberships.data) return <LoadingState />;

    const current = memberships.data.find((m) => m.seller_id === sellerId);
    const canSwitch = memberships.data.length > 1;
    return (
      <ListRow
        title={current?.seller?.name ?? 'No shop selected'}
        onPress={canSwitch ? () => router.push('/switch-shop') : undefined}
        trailing={
          canSwitch ? (
            <Text variant="label" tone="accent">
              Switch
            </Text>
          ) : null
        }
      />
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg }}>
      <Stack.Screen options={{ title: 'Settings' }} />
      <Text variant="caption" tone="secondary">
        Current shop
      </Text>
      {currentShop()}
      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
    </ScrollView>
  );
}
