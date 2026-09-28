import { EmptyState, ErrorState, LoadingState, useTheme } from '@oja/ui';
import { router, Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useListings } from '@/api/listings';
import { ShopResults } from '@/components/shop-results';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { useRegion } from '@/region/region-provider';

/** A category's products (its sub-categories' too), grouped by shop, fastest shops first. */
export function CategoryScreen({ categoryId, name }: Readonly<{ categoryId: string; name?: string }>) {
  const theme = useTheme();
  const region = useRegion();
  const listings = useListings(region.region?.id, { categoryId, limit: 100 });
  const { refreshing, refresh } = usePullToRefresh(listings.refetch);

  const content = () => {
    if (region.error) {
      return <ErrorState title="Couldn't reach the store" message={region.error.message} onRetry={region.retry} />;
    }
    if (listings.error && !listings.data) {
      return <ErrorState title="Couldn't load products" message={listings.error.message} onRetry={refresh} />;
    }
    if (!region.region || !listings.data) return <LoadingState />;
    return (
      <ShopResults
        listings={listings.data}
        currencyCode={region.region.currency_code}
        refreshing={refreshing}
        onRefresh={refresh}
        header={<View style={{ height: theme.space.md }} />}
        empty={
          <EmptyState
            title="Nothing here yet"
            message="No shop near you sells anything in this category right now."
            action={{ label: 'Back to categories', onPress: () => router.back() }}
          />
        }
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ title: name ?? '' }} />
      {content()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
