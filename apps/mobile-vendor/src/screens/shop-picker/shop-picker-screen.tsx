import { shopChoice } from '@oja/domain';
import { Button, EmptyState, ErrorState, InlineNote, PressableSurface, ShopMark, Skeleton, Text, useTheme } from '@oja/ui';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMemberships } from '@/api/sellers';
import { selectShop } from '@/session/select-shop';
import { useSession } from '@/session/session-store';
import { signOut } from '@/session/sign-out';

type Membership = NonNullable<ReturnType<typeof useMemberships>['data']>[number];

/** The shop's area, as its vendor panel profile gives it (#70). */
const areaOf = (membership: Membership) => (membership.seller as { city?: string | null } | null | undefined)?.city ?? null;

/**
 * "Which shop today?": the shops the member belongs to, with their logos (or monograms) and
 * areas, and Open for the one picked. Straight after signing in to several shops (`signIn`),
 * and from settings to switch (`switch`).
 */
export function ShopPickerScreen({ mode }: Readonly<{ mode: 'signIn' | 'switch' }>) {
  const theme = useTheme();
  const router = useRouter();
  const memberships = useMemberships();
  const switching = mode === 'switch';
  const currentSellerId = useSession()?.sellerId;
  const [picked, setPicked] = useState<string | undefined>(currentSellerId);
  const select = useMutation({
    mutationFn: selectShop,
    // Signing in, the session flip swaps to the signed-in group; switching returns to the orders.
    onSuccess: () => {
      if (switching) router.dismissTo('/');
    },
  });

  const shops = memberships.data ? shopsOf(memberships.data) : null;
  const chosen = shops?.find((m) => m.seller_id === picked) ?? shops?.[0];
  const open = () => {
    if (!chosen) return;
    if (chosen.seller_id === currentSellerId) router.back();
    else select.mutate(chosen.seller_id);
  };

  const content = () => {
    if (memberships.error && !memberships.data) {
      return (
        <ErrorState
          title="Couldn't load your shops"
          body="Check your connection and try again."
          error={memberships.error}
          onRetry={() => void memberships.refetch()}
        />
      );
    }
    if (!shops) return <RowsLoading />;
    return (
      <FlatList
        data={shops}
        keyExtractor={(m) => m.seller_id}
        contentContainerStyle={shops.length === 0 ? styles.fill : undefined}
        ListEmptyComponent={
          <EmptyState icon="store" title="No shops" body="This account isn't a member of any shop. Ask the owner to invite you." />
        }
        renderItem={({ item }) => (
          <ShopRow membership={item} selected={item.seller_id === chosen?.seller_id} onPress={() => setPicked(item.seller_id)} />
        )}
      />
    );
  };

  return (
    <SafeAreaView edges={switching ? ['bottom'] : ['top', 'bottom']} style={[styles.grow, { backgroundColor: theme.colors.bg }]}>
      <Text
        variant="titleRoot"
        style={{ paddingHorizontal: theme.space[4], paddingTop: switching ? theme.space[4] : theme.space[12], paddingBottom: theme.space[2] }}>
        Which shop today?
      </Text>
      <View style={styles.grow}>{content()}</View>
      <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
        {select.error ? (
          <InlineNote>
            {"Couldn't open that shop. Check your connection and try again."}
          </InlineNote>
        ) : null}
        {chosen ? (
          <Button label={`Open ${chosen.seller?.name ?? 'shop'}`} size="main" trailingIcon="fwd" onPress={open} loading={select.isPending} />
        ) : null}
        {switching ? null : <Button label="Sign out" variant="link" onPress={() => void signOut()} />}
      </View>
    </SafeAreaView>
  );
}

/** The member's shops, by name when there are several. */
function shopsOf(memberships: Membership[]) {
  const choice = shopChoice(memberships);
  return choice.kind === 'pick' ? choice.shops : memberships;
}

/** One shop: its mark, name and area, with a radio for picking it. */
function ShopRow({ membership, selected, onPress }: Readonly<{ membership: Membership; selected: boolean; onPress: () => void }>) {
  const theme = useTheme();
  const name = membership.seller?.name ?? 'Shop';
  const area = areaOf(membership);
  const radio = theme.icon.size.step;
  return (
    <PressableSurface
      ringInset
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={[name, area].filter(Boolean).join(', ')}
      onPress={onPress}
      style={[
        styles.row,
        {
          gap: theme.space[3],
          minHeight: theme.control.row,
          paddingVertical: theme.space[4],
          paddingHorizontal: theme.space[4],
        },
      ]}>
      <ShopMark name={name} logoUrl={membership.seller?.logo} />
      <View style={styles.grow}>
        <Text weight="bold">{name}</Text>
        {area ? (
          <Text variant="meta" tone="muted">
            {area}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          width: radio,
          height: radio,
          borderRadius: theme.radius.pill,
          // Chosen, a thick ring around a wide centre (the catalogue's 5 of 18).
          borderWidth: selected ? radio * 0.28 : theme.line.input,
          borderColor: selected ? theme.colors.accent : theme.colors.control,
        }}
      />
    </PressableSurface>
  );
}

/** Two shop rows in their shape while the member's shops load. */
function RowsLoading() {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel="Loading your shops" style={{ padding: theme.space[4], gap: theme.space[4] }}>
      {[0, 1].map((key) => (
        <View key={key} style={[styles.row, { gap: theme.space[3] }]}>
          <Skeleton width={theme.shopMark.sm.size} height={theme.shopMark.sm.size} radius="md" />
          <View style={[styles.grow, { gap: theme.space[1] }]}>
            <Skeleton width="60%" height={theme.type.body.fontSize} />
            <Skeleton width="30%" height={theme.type.meta.fontSize} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  fill: { flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
