import { Skeleton, useGridColumns, useTheme, type TopBandController } from '@oja/ui';
import type { ReactElement } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import type { Listing } from '@/api/listings';

import { ListingTile } from './listing-tile';

/**
 * Listings as product tiles two to a row (one at the largest text sizes), loading more as the
 * buyer scrolls. Until the first page arrives it shows tiles' shapes.
 */
export function ListingGrid({
  listings,
  currencyCode,
  detail,
  header,
  empty,
  more,
  onEndReached,
  refreshing,
  onRefresh,
  band,
}: Readonly<{
  /** Undefined while the first page loads. */
  listings: Listing[] | undefined;
  currencyCode: string;
  /** The line under a tile's name, e.g. its shop and distance. */
  detail?: (listing: Listing) => string | null;
  header: ReactElement;
  empty: ReactElement;
  more: boolean;
  onEndReached: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** The screen's top band, when the header opens on one: the grid reports its scroll to it. */
  band?: TopBandController;
}>) {
  const theme = useTheme();
  const columns = useGridColumns();
  const data = listings ?? [];
  return (
    <Animated.FlatList
      {...band?.scroll}
      key={columns}
      numColumns={columns}
      // An odd last tile keeps its column's width.
      data={data.length % columns ? [...data, null] : data}
      keyExtractor={(l) => (l ? `${l.seller.id}:${l.product.id}` : 'filler')}
      // Screens without a header run their band under the status bar, padded by the shared top band.
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[{ paddingBottom: theme.space[8], gap: theme.space[4] }, styles.grow]}
      columnWrapperStyle={columns > 1 ? { gap: theme.space[3], paddingHorizontal: theme.space[4] } : undefined}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing ?? false}
            onRefresh={onRefresh}
            tintColor={band ? theme.colors.onBand : undefined}
          />
        ) : undefined
      }
      ListHeaderComponent={header}
      ListEmptyComponent={listings ? empty : <GridSkeleton />}
      ListFooterComponent={more ? <GridSkeleton /> : undefined}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      renderItem={({ item }: { item: Listing | null }) => (
        <View style={columns > 1 ? styles.fill : { paddingHorizontal: theme.space[4] }}>
          {item ? (
            <ListingTile listing={item} seller={item.seller} currencyCode={currencyCode} detail={detail?.(item)} />
          ) : null}
        </View>
      )}
    />
  );
}

/** Two rows of tile shapes. */
export function GridSkeleton() {
  const theme = useTheme();
  const columns = useGridColumns();
  const cell = (key: number) => (
    <View key={key} style={[styles.fill, { gap: theme.space[2] }]}>
      <Skeleton height="auto" radius="md" style={styles.square} />
      <Skeleton width="40%" height={theme.space[3]} />
      <Skeleton width="80%" height={theme.space[3]} />
    </View>
  );
  return (
    <View
      accessible
      accessibilityLabel="Loading products"
      style={{ gap: theme.space[4], paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }}>
      {[0, 1].map((row) => (
        <View key={row} style={[styles.row, { gap: theme.space[3] }]}>
          {Array.from({ length: columns }, (_, i) => cell(i))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  row: { flexDirection: 'row' },
  square: { aspectRatio: 1 },
});
