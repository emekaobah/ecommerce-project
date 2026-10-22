import { shopChoice } from '@oja/domain';
import { Button, EmptyState, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { useMutation } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMemberships } from '@/api/sellers';
import { selectShop } from '@/session/select-shop';
import { useSession } from '@/session/session-store';
import { signOut } from '@/session/sign-out';

/**
 * Picks the shop to act for: straight after signing in to several shops
 * (`signIn`), and from settings (`switch`).
 */
export function ShopPickerScreen({ mode }: Readonly<{ mode: 'signIn' | 'switch' }>) {
  const theme = useTheme();
  const router = useRouter();
  const memberships = useMemberships();
  const switching = mode === 'switch';
  const currentSellerId = useSession()?.sellerId;
  const select = useMutation({
    mutationFn: selectShop,
    // Signing in, the session flip swaps to the signed-in group; switching returns to the orders.
    onSuccess: () => {
      if (switching) router.dismissTo('/');
    },
  });

  const content = () => {
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

    const choice = shopChoice(memberships.data);
    const shops = choice.kind === 'pick' ? choice.shops : memberships.data;
    return (
      <FlatList
        data={shops}
        keyExtractor={(m) => m.seller_id}
        contentContainerStyle={shops.length === 0 ? styles.emptyList : { paddingHorizontal: theme.space[4] }}
        ListEmptyComponent={
          <EmptyState title="No shops" message="This account isn't a member of any shop. Ask the owner to invite you." />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.seller?.name ?? item.seller_id}
            onPress={item.seller_id === currentSellerId ? undefined : () => select.mutate(item.seller_id)}
            trailing={
              item.seller_id === currentSellerId ? (
                <Text variant="meta" tone="muted">
                  Current
                </Text>
              ) : null
            }
          />
        )}
      />
    );
  };

  return (
    <SafeAreaView edges={switching ? ['bottom'] : undefined} style={styles.container}>
      <Stack.Screen options={{ title: 'Switch shop' }} />
      {switching ? null : (
        <View style={{ padding: theme.space[4] }}>
          <Text variant="titlePushed">Choose a shop</Text>
        </View>
      )}
      {select.error ? (
        <Text tone="danger" style={{ paddingHorizontal: theme.space[4] }}>
          {select.error.message}
        </Text>
      ) : null}
      <View style={styles.container}>{content()}</View>
      {switching ? null : (
        <Button label="Sign out" variant="link" onPress={() => void signOut()} style={{ margin: theme.space[4] }} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyList: { flexGrow: 1 },
});
