import { useAuth } from '@clerk/expo';
import { listingPrice, wishlistMove } from '@oja/domain';
import { Button, EmptyState, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { useMoveToCart, useToggleWishlist, useWishlist, type WishlistItem } from '@/api/wishlist';
import { useCartSession } from '@/cart/cart-provider';
import { Price } from '@/components/price';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { openListing } from '@/navigation';
import { useRegion } from '@/region/region-provider';

/** Account → Wishlist: products the buyer saved, each at the shop they saved it from. */
export function WishlistScreen() {
  const theme = useTheme();
  const { userId } = useAuth();
  const region = useRegion();
  const wishlist = useWishlist(userId, region.region?.id);
  const { refreshing, refresh } = usePullToRefresh(() => wishlist.refetch());

  if (region.error) {
    return <ErrorState title="Couldn't reach the store" message={region.error.message} onRetry={region.retry} />;
  }
  if (wishlist.error && !wishlist.data) {
    return <ErrorState title="Couldn't load your wishlist" message={wishlist.error.message} onRetry={refresh} />;
  }
  if (!region.region || !wishlist.data) return <LoadingState />;

  const { currency_code } = region.region;
  return (
    <FlatList
      data={wishlist.data}
      keyExtractor={(item) => item.product.id}
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[{ paddingHorizontal: theme.space.md }, !wishlist.data.length && styles.grow]}
      refreshing={refreshing}
      onRefresh={refresh}
      ListEmptyComponent={
        <EmptyState
          title="Nothing saved yet"
          message="Save products from their page to find them here."
          action={{ label: 'Start shopping', onPress: () => router.navigate('/') }}
        />
      }
      renderItem={({ item }) => <SavedProduct item={item} currencyCode={currency_code} />}
    />
  );
}

function SavedProduct({ item, currencyCode }: Readonly<{ item: WishlistItem; currencyCode: string }>) {
  const theme = useTheme();
  const { cartIdForAdding } = useCartSession();
  const move = useMoveToCart(cartIdForAdding);
  const remove = useToggleWishlist();
  const { listing, product } = item;
  const action = wishlistMove(item);
  const price = listing ? listingPrice(listing.offers) : null;
  const error = move.error ?? remove.error;

  return (
    <View style={{ borderBottomColor: theme.colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }}>
      <ListRow
        title={product.title}
        subtitle={listing ? listing.seller.name : 'No longer available'}
        onPress={listing ? () => openListing(listing) : undefined}
        trailing={price ? <Price price={price} currencyCode={currencyCode} /> : null}
        leading={
          product.thumbnail ? (
            <Image
              source={product.thumbnail}
              contentFit="contain"
              style={[styles.thumb, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm }]}
            />
          ) : null
        }
      />
      <View style={[styles.actions, { gap: theme.space.md, paddingBottom: theme.space.sm }]}>
        {action.kind === 'move' ? (
          <Button
            label="Move to cart"
            variant="link"
            loading={move.isPending}
            onPress={() => move.mutate({ productId: product.id, offerId: action.offerId })}
          />
        ) : null}
        {/* Several sizes or colours: the buyer picks one on the product page. */}
        {action.kind === 'choose' && listing ? (
          <Button label="Choose an option" variant="link" onPress={() => openListing(listing)} />
        ) : null}
        <Button
          label="Remove"
          variant="link"
          loading={remove.isPending}
          onPress={() => remove.mutate({ sellerId: item.seller_id, productId: product.id, save: false })}
        />
      </View>
      {error ? (
        <Text tone="secondary" accessibilityLiveRegion="polite" style={{ paddingBottom: theme.space.sm }}>
          {`Couldn't update your wishlist: ${error.message}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  thumb: { width: 64, height: 64 },
  actions: { flexDirection: 'row', alignItems: 'center' },
});
