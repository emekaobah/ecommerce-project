import { groupByShop, shipsIn, type ShopGroup } from '@oja/domain';
import { Button, Text, useTheme } from '@oja/ui';
import type { ReactElement } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import type { Listing } from '@/api/listings';
import { openShop } from '@/navigation';

import { ListingTile } from './listing-tile';

/**
 * Search and category results grouped by shop: a shop header, then a shelf of that shop's
 * matching products (docs/design.md). The same product under two shops sits in two
 * shelves, never side by side, and shops keep the backend's order (never by price).
 */
export function ShopResults({
  listings,
  currencyCode,
  empty,
  header,
  refreshing,
  onRefresh,
}: Readonly<{
  listings: Listing[];
  currencyCode: string;
  empty: ReactElement;
  header?: ReactElement;
  refreshing?: boolean;
  onRefresh?: () => void;
}>) {
  const theme = useTheme();
  const groups = groupByShop(listings);
  return (
    <FlatList
      data={groups}
      keyExtractor={(group) => group.seller.id}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      contentContainerStyle={[{ gap: theme.space.lg, paddingBottom: theme.space.xl }, !groups.length && styles.grow]}
      refreshing={refreshing}
      onRefresh={onRefresh}
      renderItem={({ item }) => <ShopShelf group={item} currencyCode={currencyCode} />}
    />
  );
}

function ShopShelf({ group, currencyCode }: Readonly<{ group: ShopGroup<Listing>; currencyCode: string }>) {
  const theme = useTheme();
  const days = group.listings
    .map((l) => l.leadtime_to_ship)
    .filter((d): d is number => d != null)
    .reduce<number | null>((min, d) => (min == null || d < min ? d : min), null);
  return (
    <View style={{ gap: theme.space.sm }}>
      <View style={[styles.header, { paddingHorizontal: theme.space.md, gap: theme.space.sm }]}>
        <View style={styles.headerText}>
          <Text variant="heading" numberOfLines={1}>
            {group.seller.name}
          </Text>
          {days == null ? null : (
            <Text variant="caption" tone="secondary">
              {shipsIn(days)}
            </Text>
          )}
        </View>
        <Button label="See all" variant="link" onPress={() => openShop(group.seller)} />
      </View>
      <FlatList
        horizontal
        data={group.listings}
        keyExtractor={(l) => l.product.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: theme.space.md, gap: theme.space.md }}
        renderItem={({ item }) => <ListingTile listing={item} currencyCode={currencyCode} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerText: { flex: 1 },
});
