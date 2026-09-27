import { Button, ListRow, Text, useTheme } from '@oja/ui';
import { Stack, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { useCurrentSeller, useMemberships } from '@/api/sellers';
import { useSession } from '@/session/session-store';
import { signOut } from '@/session/sign-out';

export function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const seller = useCurrentSeller(useSession()?.sellerId);
  const memberships = useMemberships();
  const canSwitch = (memberships.data?.length ?? 0) > 1;

  return (
    <ScrollView contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg }}>
      <Stack.Screen options={{ title: 'Settings' }} />
      <Text variant="caption" tone="secondary">
        Current shop
      </Text>
      <ListRow
        title={seller.data?.name ?? '…'}
        onPress={canSwitch ? () => router.push('/switch-shop') : undefined}
        trailing={
          canSwitch ? (
            <Text variant="label" tone="accent">
              Switch
            </Text>
          ) : null
        }
      />
      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
    </ScrollView>
  );
}
