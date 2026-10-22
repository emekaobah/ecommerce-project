import { EmptyState, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { isNotFound } from '@/api/errors';
import { useListings } from '@/api/listings';
import { useShop, type Shop } from '@/api/shops';
import { ListingRow } from '@/components/listing-row';
import { ReviewsPreview } from '@/components/reviews';
import { ShopFacts } from '@/components/shop-facts';
import { ShopStatusBadge } from '@/components/shop-status';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useRegion } from '@/region/region-provider';

/** A shop's page: its header, then only its own products at its own prices. */
export function SellerScreen({ sellerId }: Readonly<{ sellerId: string }>) {
  const theme = useTheme();
  const region = useRegion();
  const shop = useShop(region.region?.id, sellerId);
  const listings = useListings(region.region?.id, { sellerId, limit: 100 });
  const { refreshing, refresh } = usePullToRefresh(() => Promise.all([shop.refetch(), listings.refetch()]));

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
      style={{ backgroundColor: theme.colors.bg }}
      contentContainerStyle={[{ paddingHorizontal: theme.space[4] }, !listings.data.length && styles.grow]}
      refreshing={refreshing}
      onRefresh={refresh}
      ListHeaderComponent={<ShopHeader shop={shop.data} />}
      ListEmptyComponent={<EmptyState title="Nothing for sale yet" message="Check back soon." />}
      renderItem={({ item }) => <ListingRow listing={item} currencyCode={currency_code} />}
    />
  );
}

function ShopHeader({ shop }: Readonly<{ shop: Shop }>) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[1], paddingVertical: theme.space[4] }}>
      <Text variant="titleNamed">{shop.name}</Text>
      <ShopFacts seller={shop} />
      <ShopStatusBadge status={shop.shop_status} withNote />
      {shop.description ? <Text style={{ marginTop: theme.space[1] }}>{shop.description}</Text> : null}
      <View style={{ marginTop: theme.space[4] }}>
        <ReviewsPreview kind="seller" id={shop.id} title={shop.name} />
      </View>
      <Text variant="heading" style={{ marginTop: theme.space[6] }}>
        Products
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
});
