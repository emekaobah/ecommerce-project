import { departments } from '@oja/domain';
import { EmptyState, ErrorState, Icon, ListRow, SearchField, Text, useTheme } from '@oja/ui';
import { useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCategories } from '@/api/categories';
import { useListingResults } from '@/api/listings';
import { resultsLabel, ShopResults, ShopShelfSkeleton } from '@/components/shop-results';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { openCategory } from '@/navigation';
import { useRegion } from '@/region/region-provider';

/** Search by product name, results grouped by shop; with no query, browse by category. */
export function SearchScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim(), 300);

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[2], paddingBottom: theme.space[2] }}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search products" />
      </View>
      {search ? <Results search={search} onClear={() => setQuery('')} /> : <Browse />}
    </SafeAreaView>
  );
}

function Results({ search, onClear }: Readonly<{ search: string; onClear: () => void }>) {
  const theme = useTheme();
  const region = useRegion();
  const results = useListingResults(region.region?.id, { search });

  if (region.error) {
    return (
      <ErrorState
        title="Couldn't reach the store"
        body="Check your connection and try again. Anything in your cart is saved."
        error={region.error}
        onRetry={region.retry}
      />
    );
  }
  if (results.error && !results.data) {
    return (
      <ErrorState
        title="Couldn't search"
        body="Check your connection and try again."
        error={results.error}
        onRetry={() => void results.refetch()}
      />
    );
  }
  if (!region.region || !results.data) {
    return (
      <View accessible accessibilityLabel="Searching">
        <ShopShelfSkeleton />
        <ShopShelfSkeleton />
      </View>
    );
  }

  const [first] = results.data.pages;
  return (
    <ShopResults
      listings={results.data.pages.flatMap((page) => page.listings)}
      currencyCode={region.region.currency_code}
      header={
        <Text
          variant="label"
          weight="extrabold"
          tone="muted"
          style={[styles.caps, { paddingHorizontal: theme.space[4], paddingTop: theme.space[2], paddingBottom: theme.space[1] }]}>
          {resultsLabel(first?.shop_count ?? 0, first?.count ?? 0)}
        </Text>
      }
      footer={results.hasNextPage ? <ShopShelfSkeleton /> : undefined}
      onEndReached={() => {
        if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
      }}
      empty={
        <EmptyState
          title={`No results for “${search}”`}
          body="Check the spelling, or try fewer or shorter words."
          icon="search"
          secondaryAction={{ label: 'Clear search', onPress: onClear }}
        />
      }
    />
  );
}

function Browse() {
  const theme = useTheme();
  const categories = useCategories();

  if (categories.error) {
    return (
      <ErrorState
        title="Couldn't load categories"
        body="Check your connection and try again."
        error={categories.error}
        onRetry={() => void categories.refetch()}
      />
    );
  }
  if (!categories.data) return null;

  // A row for everything in the department, then one per sub-category.
  const sections = departments(categories.data).map(({ department, categories: subCategories }) => ({
    title: department.name,
    department,
    data: [department, ...subCategories],
  }));
  return (
    <SectionList
      sections={sections}
      keyExtractor={(category, index) => `${category.id}:${index}`}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      contentContainerStyle={[{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[8] }, !sections.length && styles.grow]}
      ListEmptyComponent={<EmptyState title="No categories yet" body="Search for a product by name." icon="search" />}
      renderSectionHeader={({ section }) => (
        <Text
          variant="heading"
          style={{ paddingTop: theme.space[6], paddingBottom: theme.space[1] }}>
          {section.title}
        </Text>
      )}
      renderItem={({ item, section }) => (
        <ListRow
          title={item.id === section.department.id ? `All ${item.name.toLowerCase()}` : item.name}
          onPress={() => openCategory(item)}
          trailing={<Icon name="fwd" use="chip" color={theme.colors.muted} />}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  grow: { flexGrow: 1 },
  caps: { textTransform: 'uppercase', letterSpacing: 0.6 },
});
