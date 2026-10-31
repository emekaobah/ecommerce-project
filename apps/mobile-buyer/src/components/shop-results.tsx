import { groupByShop, type ShopGroup } from '@oja/domain';
import { Icon, PressableSurface, ProductRail, ShopMark, Skeleton, Text, useTheme } from '@oja/ui';
import type { ReactElement } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import type { Listing } from '@/api/listings';
import { openShop } from '@/navigation';

import { ListingTile } from './listing-tile';
import { ShopStatusLine } from './shop-status';

type RowSeller = Pick<Listing['seller'], 'id' | 'name' | 'logo' | 'shop_status' | 'distance_km'>;

/**
 * A shop heading its products: its mark, name, open state and distance, and "Shop" to open its
 * page. The whole row opens the shop.
 */
export function ShopRow({ seller }: Readonly<{ seller: RowSeller }>) {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={`${seller.name}, ${seller.shop_status.label}`}
      accessibilityHint="Opens the shop"
      ringInset
      onPress={() => openShop(seller)}
      style={[
        styles.row,
        {
          minHeight: theme.hitArea,
          gap: theme.space[3],
          paddingHorizontal: theme.space[4],
          paddingTop: theme.space[2],
          paddingBottom: theme.space[1],
        },
      ]}>
      <ShopMark name={seller.name} logoUrl={seller.logo} size="sm" />
      <View style={[styles.fill, { gap: theme.space[1] }]}>
        <Text variant="body" weight="extrabold">
          {seller.name}
        </Text>
        <ShopStatusLine status={seller.shop_status} distanceKm={seller.distance_km} />
      </View>
      <View style={[styles.row, { gap: theme.space[1] }]}>
        <Text variant="meta" tone="muted">
          Shop
        </Text>
        <Icon name="fwd" use="chip" color={theme.colors.muted} />
      </View>
    </PressableSurface>
  );
}

/** A shop's row, then a rail of its products. */
export function ShopShelf({
  seller,
  listings,
  currencyCode,
  onOpenProduct,
}: Readonly<{
  seller: RowSeller;
  listings: Pick<Listing, 'product' | 'offers' | 'deals'>[];
  currencyCode: string;
  onOpenProduct?: () => void;
}>) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2], paddingBottom: theme.space[3] }}>
      <ShopRow seller={seller} />
      {listings.length ? (
        <ProductRail label={`Products from ${seller.name}`}>
          {listings.map((listing) => (
            <ListingTile
              key={listing.product.id}
              listing={listing}
              seller={seller}
              currencyCode={currencyCode}
              onOpen={onOpenProduct}
            />
          ))}
        </ProductRail>
      ) : null}
    </View>
  );
}

/**
 * Search results grouped by shop (docs/design.md): a shop row, then a rail of that shop's
 * matching products. The same product under two shops sits in two rails, never side by side, and
 * shops keep the backend's order (never by price). More load as the buyer scrolls.
 */
export function ShopResults({
  listings,
  currencyCode,
  header,
  empty,
  footer,
  onEndReached,
  onOpenProduct,
}: Readonly<{
  listings: Listing[];
  currencyCode: string;
  header?: ReactElement;
  empty: ReactElement;
  footer?: ReactElement;
  onEndReached?: () => void;
  /** Told when a product is opened from the results. */
  onOpenProduct?: () => void;
}>) {
  const theme = useTheme();
  const groups = groupByShop(listings);
  return (
    <FlatList
      data={groups}
      keyExtractor={(group) => group.seller.id}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={groups.length ? header : undefined}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      ItemSeparatorComponent={ShelfGap}
      contentContainerStyle={[{ paddingBottom: theme.space[8] }, !groups.length && styles.grow]}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      renderItem={({ item }: { item: ShopGroup<Listing> }) => (
        <ShopShelf seller={item.seller} listings={item.listings} currencyCode={currencyCode} onOpenProduct={onOpenProduct} />
      )}
    />
  );
}

function ShelfGap() {
  const theme = useTheme();
  return <View style={{ height: theme.space[2], backgroundColor: theme.colors.tile }} />;
}

/** "2 shops · 5 products": what every page of results holds, not just those loaded. */
export function resultsLabel(shops: number, products: number): string {
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  return `${plural(shops, 'shop')} · ${plural(products, 'product')}`;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  clip: { overflow: 'hidden' },
});

/** A shop row and its rail while they load, in the shapes they will fill (State rules). */
export function ShopShelfSkeleton() {
  const theme = useTheme();
  const tile = theme.block.railTile;
  return (
    <View style={{ gap: theme.space[2], paddingBottom: theme.space[4] }}>
      <View style={[styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[4], paddingTop: theme.space[3] }]}>
        <Skeleton width={theme.shopMark.sm.size} height={theme.shopMark.sm.size} radius="md" />
        <View style={[styles.fill, { gap: theme.space[2] }]}>
          <Skeleton width="55%" height={theme.space[3]} />
          <Skeleton width="75%" height={theme.space[2] + theme.space[1]} />
        </View>
      </View>
      <View style={[styles.row, styles.clip, { gap: theme.space[2], paddingHorizontal: theme.space[4] }]}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ width: tile, gap: theme.space[2] }}>
            <Skeleton width={tile} height={tile} radius="lg" />
            <Skeleton width="60%" height={theme.space[3]} />
            <Skeleton width="85%" height={theme.space[2] + theme.space[1]} />
          </View>
        ))}
      </View>
    </View>
  );
}
