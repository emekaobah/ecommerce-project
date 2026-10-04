import { useAuth } from '@clerk/expo';
import { deliveryEstimate, formatMoney, formatWeight, isSaved, listingPrice, offerPrice, shipsIn } from '@oja/domain';
import { Button, EmptyState, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAddToCart } from '@/api/cart';
import { isNotFound } from '@/api/errors';
import { useDeliveryEstimate, useListing, useListings, type Listing, type ListingDetail } from '@/api/listings';
import { useToggleWishlist, useWishlist } from '@/api/wishlist';
import { useCartSession } from '@/cart/cart-provider';
import { ListingTile, LISTING_TILE_SIZE } from '@/components/listing-tile';
import { Price } from '@/components/price';
import { openShop } from '@/navigation';
import { useRegion } from '@/region/region-provider';

/**
 * A product in one shop's context: that shop's price and ship time, never another shop's.
 * Without a shop there is nothing to show (docs/design.md).
 */
export function ProductScreen({ sellerId, productId }: Readonly<{ sellerId?: string; productId: string }>) {
  if (!sellerId) {
    return (
      <EmptyState
        title="Pick a shop"
        message="Open this product from a shop's listing."
        action={{ label: 'Back to shopping', onPress: () => router.back() }}
      />
    );
  }
  return <ShopProduct sellerId={sellerId} productId={productId} />;
}

function ShopProduct({ sellerId, productId }: Readonly<{ sellerId: string; productId: string }>) {
  const theme = useTheme();
  const region = useRegion();
  const listing = useListing(region.region?.id, sellerId, productId);

  if (region.error) {
    return <ErrorState title="Couldn't reach the store" message={region.error.message} onRetry={region.retry} />;
  }
  if (listing.error) {
    if (isNotFound(listing.error)) {
      return (
        <EmptyState
          title="No longer available"
          message="This shop isn't selling this product right now."
          action={{ label: 'Back to shopping', onPress: () => router.back() }}
        />
      );
    }
    return (
      <ErrorState
        title="Couldn't load this product"
        message={listing.error.message}
        onRetry={() => void listing.refetch()}
      />
    );
  }
  if (!region.region || !listing.data) return <LoadingState />;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ paddingBottom: theme.space.xxl, gap: theme.space.lg }}>
      <Gallery images={listing.data.product.images} />
      <View style={{ paddingHorizontal: theme.space.md, gap: theme.space.lg }}>
        <Summary listing={listing.data} currencyCode={region.region.currency_code} />
        <Details product={listing.data.product} />
        <Attribution credits={listing.data.product.attribution} />
      </View>
      <MoreFromShop
        regionId={region.region.id}
        currencyCode={region.region.currency_code}
        seller={listing.data.seller}
        productId={productId}
      />
    </ScrollView>
  );
}

function Gallery({ images }: Readonly<{ images: ListingDetail['product']['images'] }>) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const size = width - theme.space.md * 2;
  if (!images.length) return null;
  return (
    <FlatList
      horizontal
      data={images}
      keyExtractor={(image) => image.id}
      showsHorizontalScrollIndicator={false}
      snapToInterval={size + theme.space.sm}
      decelerationRate="fast"
      contentContainerStyle={{ paddingHorizontal: theme.space.md, gap: theme.space.sm }}
      renderItem={({ item }) => (
        // Pack shots sit contained on a neutral tile (docs/design.md).
        <Image
          source={item.url}
          contentFit="contain"
          accessibilityIgnoresInvertColors
          style={{ width: size, height: size, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg }}
        />
      )}
    />
  );
}

function Summary({ listing, currencyCode }: Readonly<{ listing: ListingDetail; currencyCode: string }>) {
  const theme = useTheme();
  const { offers, product, seller } = listing;
  // Starts on the shop's cheapest variant, matching the "from" price in the feed.
  const [selectedId, setSelectedId] = useState(() => listingPrice(offers)?.offerId);
  const selected = offers.find((o) => o.id === selectedId) ?? offers[0];

  return (
    <View style={{ gap: theme.space.sm }}>
      <Text variant="title">{product.title}</Text>
      {product.subtitle ? <Text tone="secondary">{product.subtitle}</Text> : null}
      {selected ? <Price price={offerPrice(selected)} currencyCode={currencyCode} variant="heading" /> : null}
      <View style={[styles.shopRow, { gap: theme.space.xs }]}>
        <Button label={seller.name} variant="link" onPress={() => openShop(seller)} style={styles.inlineLink} />
        <DeliveryTime listing={listing} currencyCode={currencyCode} />
      </View>
      {offers.length > 1 ? (
        <View style={[styles.chips, { gap: theme.space.sm, marginTop: theme.space.sm }]} accessibilityRole="radiogroup">
          {offers.map((offer) => {
            const isSelected = offer.id === selected?.id;
            return (
              <Pressable
                key={offer.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelectedId(offer.id)}
                style={[
                  styles.chip,
                  {
                    minHeight: theme.touchTarget,
                    minWidth: theme.touchTarget,
                    paddingHorizontal: theme.space.md,
                    borderRadius: theme.radius.md,
                    borderColor: isSelected ? theme.colors.ink : theme.colors.divider,
                    borderWidth: isSelected ? 2 : 1,
                  },
                ]}>
                <Text variant="label">{offer.variant_title ?? 'Default'}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {selected ? <AddToCart offer={selected} currencyCode={currencyCode} /> : null}
      <SaveToWishlist sellerId={seller.id} productId={product.id} />
      {product.description ? <Text style={{ marginTop: theme.space.sm }}>{product.description}</Text> : null}
    </View>
  );
}

/**
 * When it would arrive: for a buyer with a saved address, the shop's best-value courier rate
 * there ("Arrives tomorrow · ₦2,500 delivery", #23); otherwise, or until that loads, the shop's
 * dispatch time ("Ships in 2 days").
 */
function DeliveryTime({ listing, currencyCode }: Readonly<{ listing: ListingDetail; currencyCode: string }>) {
  const { userId } = useAuth();
  const { region } = useRegion();
  const { data: estimate } = useDeliveryEstimate(region?.id, listing.seller.id, listing.product.id, userId);
  if (estimate) {
    return (
      <Text tone="secondary">
        · {deliveryEstimate(estimate.delivery_eta_time, new Date(), estimate.time_zone)} ·{' '}
        {formatMoney(estimate.amount, currencyCode)} delivery
      </Text>
    );
  }
  return listing.leadtime_to_ship == null ? null : <Text tone="secondary">· {shipsIn(listing.leadtime_to_ship)}</Text>;
}

/** Adds the selected variant at this shop's price; the button carries the price (docs/design.md). */
function AddToCart({ offer, currencyCode }: Readonly<{ offer: ListingDetail['offers'][number]; currencyCode: string }>) {
  const theme = useTheme();
  const { cartId, cartIdForAdding } = useCartSession();
  const add = useAddToCart(cartIdForAdding);
  // "Added" belongs to the variant just added, not the one selected since.
  const added = add.isSuccess && add.variables?.offerId === offer.id;
  return (
    <View style={{ gap: theme.space.sm, marginTop: theme.space.sm }}>
      <Button
        label="Add to cart"
        detail={formatMoney(offerPrice(offer).amount, currencyCode)}
        loading={add.isPending}
        disabled={cartId === undefined}
        onPress={() => add.mutate({ offerId: offer.id })}
      />
      {added ? (
        <View style={[styles.addedRow, { gap: theme.space.sm }]} accessibilityLiveRegion="polite">
          <Text tone="secondary">Added to your cart.</Text>
          <Button label="View cart" variant="link" onPress={() => router.navigate('/cart')} />
        </View>
      ) : null}
      {add.error ? (
        <Text tone="secondary" accessibilityLiveRegion="polite">
          Couldn't add this to your cart: {add.error.message}
        </Text>
      ) : null}
    </View>
  );
}

/** Saves the product from this shop; a guest is sent to sign in first. */
function SaveToWishlist({ sellerId, productId }: Readonly<{ sellerId: string; productId: string }>) {
  const { isSignedIn, userId } = useAuth();
  const { region } = useRegion();
  const wishlist = useWishlist(isSignedIn ? userId : null, region?.id);
  const toggle = useToggleWishlist();
  const saved = isSaved(wishlist.data ?? [], sellerId, productId);

  if (!isSignedIn) {
    return <Button label="Save to wishlist" variant="secondary" onPress={() => router.push('/sign-in')} />;
  }
  return (
    <View>
      <Button
        label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
        variant="secondary"
        loading={toggle.isPending}
        // Until the wishlist loads, it isn't known which way the toggle goes.
        disabled={!wishlist.data}
        onPress={() => toggle.mutate({ sellerId, productId, save: !saved })}
      />
      {toggle.error ? (
        <Text tone="secondary" accessibilityLiveRegion="polite">
          {`Couldn't update your wishlist: ${toggle.error.message}`}
        </Text>
      ) : null}
    </View>
  );
}

function Details({ product }: Readonly<{ product: ListingDetail['product'] }>) {
  const theme = useTheme();
  const rows = [
    ...product.attributes.map((a) => ({ label: a.name, value: a.values.join(', ') })),
    ...(product.weight ? [{ label: 'Weight', value: formatWeight(product.weight) }] : []),
  ];
  if (!rows.length) return null;
  return (
    <View style={{ gap: theme.space.sm }}>
      <Text variant="heading">Details</Text>
      {rows.map((row) => (
        <View
          key={row.label}
          style={[styles.detailRow, { borderBottomColor: theme.colors.divider, paddingVertical: theme.space.sm }]}>
          <Text tone="secondary" style={styles.detailLabel}>
            {row.label}
          </Text>
          <Text style={styles.detailValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** Credits for product data taken from databases whose licence requires it (e.g. Open Food Facts). */
function Attribution({ credits }: Readonly<{ credits: ListingDetail['product']['attribution'] }>) {
  const theme = useTheme();
  if (!credits.length) return null;
  return (
    <View style={{ gap: theme.space.xs }}>
      {credits.map((credit) => (
        <Pressable
          key={credit.name}
          accessibilityRole="link"
          accessibilityHint="Opens the source in your browser"
          onPress={() => void Linking.openURL(credit.url)}
          style={{ minHeight: theme.touchTarget, justifyContent: 'center' }}>
          <Text variant="caption" tone="secondary">
            Product information from <Text variant="caption" tone="accent">{credit.name}</Text> ({credit.license})
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function MoreFromShop({
  regionId,
  currencyCode,
  seller,
  productId,
}: Readonly<{ regionId: string; currencyCode: string; seller: Listing['seller']; productId: string }>) {
  const theme = useTheme();
  const suggestions = useListings(regionId, { sellerId: seller.id, excludeProductId: productId, limit: 10 });

  const content = () => {
    if (suggestions.error) {
      return (
        <View style={{ paddingHorizontal: theme.space.md, gap: theme.space.xs, alignItems: 'flex-start' }}>
          <Text tone="secondary">Couldn't load more from this shop.</Text>
          <Button label="Try again" variant="link" onPress={() => void suggestions.refetch()} />
        </View>
      );
    }
    // Inline, so the shelf doesn't take over the page while it loads.
    if (!suggestions.data) {
      return <ActivityIndicator color={theme.colors.ink} style={{ height: LISTING_TILE_SIZE }} accessibilityLabel="Loading" />;
    }
    return (
      <FlatList
        horizontal
        data={suggestions.data}
        keyExtractor={(l) => l.product.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: theme.space.md, gap: theme.space.md }}
        renderItem={({ item }) => <ListingTile listing={item} currencyCode={currencyCode} />}
      />
    );
  };

  // Nothing else from this shop: leave the section out rather than show an empty shelf.
  if (suggestions.data?.length === 0) return null;
  return (
    <View style={{ gap: theme.space.sm }}>
      <Text variant="heading" style={{ paddingHorizontal: theme.space.md }}>
        More from {seller.name}
      </Text>
      {content()}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { alignItems: 'center', justifyContent: 'center' },
  addedRow: { flexDirection: 'row', alignItems: 'center' },
  shopRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  inlineLink: { paddingHorizontal: 0 },
  detailRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  detailLabel: { flex: 1 },
  detailValue: { flex: 2 },
});
