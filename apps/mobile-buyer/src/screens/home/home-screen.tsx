import { listingPrice, PRODUCT_NAME } from '@oja/domain';
import { EmptyState, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useListings } from '@/api/listings';
import { Price } from '@/components/price';
import { useRegion } from '@/region/region-provider';

export function HomeScreen() {
  const theme = useTheme();
  const region = useRegion();
  const listings = useListings(region.region?.id);
  // Only a pull shows the spinner; background refetches stay silent.
  const [pulling, setPulling] = useState(false);
  const refresh = () => {
    setPulling(true);
    void listings.refetch().finally(() => setPulling(false));
  };

  const content = () => {
    if (region.error) {
      return <ErrorState title="Couldn't reach the store" message={region.error.message} onRetry={region.retry} />;
    }
    // A failed refresh keeps the list already on screen.
    if (listings.error && !listings.data) {
      return <ErrorState title="Couldn't load products" message={listings.error.message} onRetry={refresh} />;
    }
    if (!region.region || !listings.data) return <LoadingState />;

    const { currency_code } = region.region;
    return (
      <FlatList
        data={listings.data}
        keyExtractor={(l) => `${l.seller.id}:${l.product.id}`}
        contentContainerStyle={listings.data.length === 0 && styles.emptyList}
        ListEmptyComponent={<EmptyState title="No products yet" message="Check back soon." />}
        refreshing={pulling}
        onRefresh={refresh}
        renderItem={({ item }) => {
          const price = listingPrice(item.offers);
          return (
            <ListRow
              title={item.product.title}
              subtitle={item.seller.name}
              onPress={() =>
                router.push({ pathname: '/product/[id]', params: { id: item.product.id, seller: item.seller.id } })
              }
              trailing={price ? <Price price={price} from={price.from} currencyCode={currency_code} /> : null}
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
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: theme.colors.background, paddingHorizontal: theme.space.md }]}>
      <Text variant="title" style={{ marginVertical: theme.space.md }}>
        {PRODUCT_NAME}
      </Text>
      {content()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyList: { flexGrow: 1 },
  thumb: { width: 64, height: 64 },
});
