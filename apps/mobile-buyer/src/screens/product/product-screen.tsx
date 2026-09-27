import { ClientError } from '@oja/api-client';
import { formatWeight, listingPrice, offerPrice, shipsIn } from '@oja/domain';
import { Button, EmptyState, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useListing, useListings, type Listing, type ListingDetail } from '@/api/listings';
import { Price } from '@/components/price';
import { openListing } from '@/navigation';
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
    if (listing.error instanceof ClientError && listing.error.status === 404) {
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
      <Text tone="secondary">
        {listing.leadtime_to_ship == null ? seller.name : `${seller.name} · ${shipsIn(listing.leadtime_to_ship)}`}
      </Text>
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
      {product.description ? <Text style={{ marginTop: theme.space.sm }}>{product.description}</Text> : null}
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
      return <ActivityIndicator color={theme.colors.ink} style={{ height: TILE }} accessibilityLabel="Loading" />;
    }
    return (
      <FlatList
        horizontal
        data={suggestions.data}
        keyExtractor={(l) => l.product.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: theme.space.md, gap: theme.space.md }}
        renderItem={({ item }) => <SuggestionTile listing={item} currencyCode={currencyCode} />}
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

const TILE = 140;

function SuggestionTile({ listing, currencyCode }: Readonly<{ listing: Listing; currencyCode: string }>) {
  const theme = useTheme();
  const price = listingPrice(listing.offers);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openListing(listing)}
      style={({ pressed }) => [{ width: TILE, gap: theme.space.xs }, pressed && styles.pressed]}>
      <Image
        source={listing.product.thumbnail}
        contentFit="contain"
        style={{ width: TILE, height: TILE, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md }}
      />
      <Text variant="caption" numberOfLines={2}>
        {listing.product.title}
      </Text>
      {price ? <Price price={price} currencyCode={currencyCode} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { alignItems: 'center', justifyContent: 'center' },
  detailRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  detailLabel: { flex: 1 },
  detailValue: { flex: 2 },
  pressed: { opacity: 0.6 },
});
