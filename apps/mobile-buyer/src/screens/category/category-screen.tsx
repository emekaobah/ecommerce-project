import { distanceLabel } from '@oja/domain';
import { EmptyState, ErrorState, FilterChips, Icon, PressableSurface, Text, useTheme } from '@oja/ui';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCategories } from '@/api/categories';
import { useListingResults, type Listing } from '@/api/listings';
import { ListingGrid } from '@/components/listing-grid';
import { useDeliveringTo } from '@/delivering-to/delivering-to-provider';
import { useListRefresh } from '@/hooks/use-list-refresh';
import { useRegion } from '@/region/region-provider';

/**
 * A category's products (its sub-categories' too) as a grid, nearest shops first; chips narrow it
 * to one sub-category. Every card ends with the shop that sells it and how far away it is.
 */
export function CategoryScreen({ categoryId, name }: Readonly<{ categoryId: string; name?: string }>) {
  const theme = useTheme();
  const region = useRegion();
  const { address } = useDeliveringTo();
  const [selected, setSelected] = useState(categoryId);
  const results = useListingResults(region.region?.id, { categoryId: selected });

  const { refreshing, refresh } = useListRefresh(results.refetch);

  const header = (
    <Stack.Screen
      options={{
        title: name ?? '',
        headerRight: () => <SearchButton />,
      }}
    />
  );

  const error = region.error ?? (results.data ? null : results.error);
  if (error) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
        {header}
        <ErrorState
          title="Couldn't reach the store"
          body="Check your connection and try again. Anything in your cart is saved."
          error={error}
          onRetry={region.error ? region.retry : refresh}
        />
      </View>
    );
  }

  const currencyCode = region.region?.currency_code;
  const shopCount = results.data?.pages[0]?.shop_count ?? 0;
  const shops = `${shopCount} ${shopCount === 1 ? 'shop' : 'shops'}`;

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      {header}
      <ListingGrid
        listings={currencyCode ? results.data?.pages.flatMap((page) => page.listings) : undefined}
        currencyCode={currencyCode ?? ''}
        detail={(listing) => shopDetail(listing.seller)}
        refreshing={refreshing}
        onRefresh={refresh}
        more={results.hasNextPage}
        onEndReached={() => {
          if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
        }}
        header={
          <View>
            <SubCategoryChips categoryId={categoryId} selected={selected} onSelect={setSelected} />
            {shopCount ? (
              <Text variant="meta" weight="bold" tone="muted" style={{ paddingHorizontal: theme.space[4] }}>
                {address ? `From ${shops} near you, nearest first` : `From ${shops}`}
              </Text>
            ) : null}
          </View>
        }
        empty={
          <EmptyState
            title="Nothing here yet"
            body="No shop near you sells anything in this category right now."
            icon="store"
            secondaryAction={{ label: 'Back to shops near you', onPress: () => router.navigate('/') }}
          />
        }
      />
    </View>
  );
}

/** "Iya Bisi Foodstuff · 1 km": who sells it and how far, when the buyer has an address. */
const shopDetail = (seller: Listing['seller']) =>
  seller.distance_km == null ? seller.name : `${seller.name} · ${distanceLabel(seller.distance_km)}`;

/** The header's search button: Search, from any category. */
function SearchButton() {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel="Search products"
      onPress={() => router.navigate('/search')}
      style={[styles.center, { width: theme.hitArea, height: theme.hitArea }]}>
      <Icon name="search" color={theme.colors.ink} />
    </PressableSurface>
  );
}

/** "All", then the category's own sub-categories from the category tree; none when it has none. */
function SubCategoryChips({
  categoryId,
  selected,
  onSelect,
}: Readonly<{ categoryId: string; selected: string; onSelect: (id: string) => void }>) {
  const categories = useCategories();
  const children = (categories.data ?? [])
    .filter((c) => c.parent_category_id === categoryId)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  if (!children.length) return null;
  const options = [{ id: categoryId, label: 'All' }, ...children.map((c) => ({ id: c.id, label: c.name }))];
  return <FilterChips options={options} selected={selected} onSelect={onSelect} label="Sub-categories" />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
