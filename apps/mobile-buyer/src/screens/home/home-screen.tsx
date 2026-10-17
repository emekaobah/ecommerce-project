import { PRODUCT_NAME } from '@oja/domain';
import { EmptyState, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useListings } from '@/api/listings';
import { DeliveringToPicker } from '@/components/delivering-to-picker';
import { ListingRow } from '@/components/listing-row';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useRegion } from '@/region/region-provider';

export function HomeScreen() {
  const theme = useTheme();
  const region = useRegion();
  const listings = useListings(region.region?.id);
  const { refreshing, refresh } = usePullToRefresh(listings.refetch);

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
        refreshing={refreshing}
        onRefresh={refresh}
        renderItem={({ item }) => <ListingRow listing={item} currencyCode={currency_code} showShop />}
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
      <View style={{ marginBottom: theme.space.md }}>
        <DeliveringToPicker />
      </View>
      {content()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyList: { flexGrow: 1 },
});
