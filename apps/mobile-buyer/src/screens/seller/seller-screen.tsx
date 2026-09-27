import { listingPrice, shipsIn } from '@oja/domain';
import { EmptyState, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { isNotFound } from '@/api/errors';
import { useListings } from '@/api/listings';
import { useShop, type Shop } from '@/api/shops';
import { Price } from '@/components/price';
import { openListing } from '@/navigation';
import { useRegion } from '@/region/region-provider';

/** A shop's page: its header, then only its own products at its own prices. */
export function SellerScreen({ sellerId }: Readonly<{ sellerId: string }>) {
  const theme = useTheme();
  const region = useRegion();
  const shop = useShop(region.region?.id, sellerId);
  const listings = useListings(region.region?.id, { sellerId, limit: 100 });
  const [pulling, setPulling] = useState(false);
  const refresh = () => {
    setPulling(true);
    void Promise.all([shop.refetch(), listings.refetch()]).finally(() => setPulling(false));
  };

  if (region.error) {
    return <ErrorState title="Couldn't reach the store" message={region.error.message} onRetry={region.retry} />;
  }
  if (shop.error && isNotFound(shop.error)) {
    return (
      <EmptyState
        title="Shop closed"
        message="This shop isn't selling in your area right now."
        action={{ label: 'Back to shopping', onPress: () => router.back() }}
      />
    );
  }
  const error = (!shop.data && shop.error) || (!listings.data && listings.error);
  if (error) return <ErrorState title="Couldn't load this shop" message={error.message} onRetry={refresh} />;
  if (!region.region || !shop.data || !listings.data) return <LoadingState />;

  const { currency_code } = region.region;
  return (
    <FlatList
      data={listings.data}
      keyExtractor={(l) => l.product.id}
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[{ paddingHorizontal: theme.space.md }, !listings.data.length && styles.grow]}
      refreshing={pulling}
      onRefresh={refresh}
      ListHeaderComponent={<ShopHeader shop={shop.data} />}
      ListEmptyComponent={<EmptyState title="Nothing for sale yet" message="Check back soon." />}
      renderItem={({ item }) => {
        const price = listingPrice(item.offers);
        return (
          <ListRow
            title={item.product.title}
            onPress={() => openListing(item)}
            trailing={price ? <Price price={price} currencyCode={currency_code} /> : null}
            leading={
              item.product.thumbnail ? (
                <Image
                  source={item.product.thumbnail}
                  contentFit="contain"
                  style={[styles.thumb, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm }]}
                />
              ) : null
            }
          />
        );
      }}
    />
  );
}

function ShopHeader({ shop }: Readonly<{ shop: Shop }>) {
  const theme = useTheme();
  const facts = [shop.area, shop.leadtime_to_ship == null ? null : shipsIn(shop.leadtime_to_ship)].filter(Boolean);
  return (
    <View style={{ gap: theme.space.xs, paddingVertical: theme.space.md }}>
      <Text variant="title">{shop.name}</Text>
      {facts.length ? <Text tone="secondary">{facts.join(' · ')}</Text> : null}
      {shop.description ? <Text style={{ marginTop: theme.space.xs }}>{shop.description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  thumb: { width: 64, height: 64 },
});
