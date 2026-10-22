import { Button, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { Stack, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { useMemberships } from '@/api/sellers';
import { useSession } from '@/session/session-store';
import { signOut } from '@/session/sign-out';

import { PauseOrders } from './pause-orders';

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
          body="Check your connection and try again." error={memberships.error}
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
            <Text variant="strong" tone="accent">
              Switch
            </Text>
          ) : null
        }
      />
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6] }}>
      <Stack.Screen options={{ title: 'Settings' }} />
      <Text variant="meta" tone="muted">
        Current shop
      </Text>
      {currentShop()}
      {sellerId ? (
        <>
          <Text variant="meta" tone="muted">
            Orders
          </Text>
          <PauseOrders sellerId={sellerId} />
        </>
      ) : null}
      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
    </ScrollView>
  );
}
