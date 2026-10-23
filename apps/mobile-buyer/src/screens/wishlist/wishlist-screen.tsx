import { useAuth } from '@clerk/expo';
import { EmptyState, ErrorState, ProductTile, useGridColumns, useTheme } from '@oja/ui';
import { router, Stack } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import type { Listing } from '@/api/listings';
import { useToggleWishlist, useWishlist, type WishlistItem } from '@/api/wishlist';
import { GridSkeleton } from '@/components/listing-grid';
import { ListingTile } from '@/components/listing-tile';
import { useListRefresh } from '@/hooks/use-list-refresh';
import { useRegion } from '@/region/region-provider';

/**
 * Account → Saved items: products the buyer saved, each at the shop they saved it from. A shop on
 * a break keeps its items visible, greyed, with when it reopens and no add button. Removing an
 * item happens on its product screen, where the save button lives.
 */
export function WishlistScreen() {
  const theme = useTheme();
  const { userId } = useAuth();
  const region = useRegion();
  const columns = useGridColumns();
  const wishlist = useWishlist(userId, region.region?.id);
  const { refreshing, refresh } = useListRefresh(wishlist.refetch);
  const title = <Stack.Screen options={{ title: 'Saved' }} />;

  const error = region.error ?? (wishlist.data ? null : wishlist.error);
  if (error) {
    return (
      <>
        {title}
        <ErrorState
          title="Couldn't load your saved items"
          body="Check your connection and try again. Anything in your cart is saved."
          error={error}
          onRetry={region.error ? region.retry : refresh}
        />
      </>
    );
  }
  if (!region.region || !wishlist.data) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.colors.bg, paddingTop: theme.space[2] }]}>
        {title}
        <GridSkeleton />
      </View>
    );
  }

  const { currency_code } = region.region;
  const items = wishlist.data;
  return (
    <>
      {title}
      <FlatList
        key={columns}
        numColumns={columns}
        // An odd last tile keeps its column's width.
        data={items.length % columns ? [...items, null] : items}
        keyExtractor={(item) => item?.product.id ?? 'filler'}
        style={{ backgroundColor: theme.colors.bg }}
        contentContainerStyle={[{ paddingTop: theme.space[2], paddingBottom: theme.space[8], gap: theme.space[4] }, styles.grow]}
        columnWrapperStyle={columns > 1 ? { gap: theme.space[3], paddingHorizontal: theme.space[4] } : undefined}
        refreshing={refreshing}
        onRefresh={refresh}
        ListEmptyComponent={
          <EmptyState
            title="Nothing saved yet"
            body="Save products from their page to find them here."
            icon="heart"
            action={{ label: 'Browse shops near you', onPress: () => router.navigate('/') }}
          />
        }
        renderItem={({ item }) => (
          <View style={columns > 1 ? styles.fill : { paddingHorizontal: theme.space[4] }}>
            {item ? <SavedProduct item={item} currencyCode={currency_code} /> : null}
          </View>
        )}
      />
    </>
  );
}

/** "Iya Bisi Foodstuff · open", "Adire House · closed until Tue 28 Oct". */
function shopDetail(seller: Listing['seller']): string {
  const { state, label } = seller.shop_status;
  const status = state === 'open' ? 'open' : label.charAt(0).toLowerCase() + label.slice(1);
  return `${seller.name} · ${status}`;
}

function SavedProduct({ item, currencyCode }: Readonly<{ item: WishlistItem; currencyCode: string }>) {
  const remove = useToggleWishlist();
  if (item.listing) {
    return (
      <ListingTile
        listing={item.listing}
        seller={item.listing.seller}
        currencyCode={currencyCode}
        detail={shopDetail(item.listing.seller)}
      />
    );
  }
  // The shop stopped selling it: it has no page left to remove it from, so its heart stays here.
  return (
    <ProductTile
      name={item.product.title}
      imageUrl={item.product.thumbnail}
      price=""
      detail="No longer available"
      onPress={() => undefined}
      saved
      onToggleSave={() => remove.mutate({ sellerId: item.seller_id, productId: item.product.id, save: false })}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
});
