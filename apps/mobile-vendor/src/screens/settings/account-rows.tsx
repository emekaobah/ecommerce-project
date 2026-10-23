import { Button, ErrorState, ListRow, LoadingState, Text } from '@oja/ui';
import { useRouter } from 'expo-router';

import { useMemberships } from '@/api/sellers';
import { signOut } from '@/session/sign-out';

/** Below the shop's card: the current shop (with Switch when the member works at more than one) and Sign out. */
export function AccountRows({ sellerId }: Readonly<{ sellerId: string | undefined }>) {
  const router = useRouter();
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
    <>
      {currentShop()}
      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
    </>
  );
}
