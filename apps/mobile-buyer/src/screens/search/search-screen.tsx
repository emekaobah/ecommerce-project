import { departments } from '@oja/domain';
import { EmptyState, ErrorState, ListRow, LoadingState, Text, useTheme } from '@oja/ui';
import { useState } from 'react';
import { Pressable, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCategories } from '@/api/categories';
import { useListings } from '@/api/listings';
import { ShopResults } from '@/components/shop-results';
import { openCategory } from '@/navigation';
import { useRegion } from '@/region/region-provider';

import { useDebouncedValue } from './use-debounced-value';

/** Search by product name; with no query, browse by category. */
export function SearchScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim(), 300);

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={{ paddingHorizontal: theme.space.md, paddingVertical: theme.space.md, gap: theme.space.md }}>
        <Text variant="title">Search</Text>
        <View
          style={[
            styles.field,
            {
              minHeight: theme.touchTarget,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.md,
              paddingLeft: theme.space.md,
            },
          ]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search products"
            placeholderTextColor={theme.colors.textSecondary}
            accessibilityLabel="Search products"
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="never"
            style={[styles.input, theme.type.body, { color: theme.colors.ink, fontFamily: theme.fontFamily }]}
          />
          {query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              style={[styles.clear, { minWidth: theme.touchTarget, minHeight: theme.touchTarget }]}>
              <Text tone="secondary">✕</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {search ? <Results search={search} onClear={() => setQuery('')} /> : <Browse />}
    </SafeAreaView>
  );
}

function Results({ search, onClear }: Readonly<{ search: string; onClear: () => void }>) {
  const region = useRegion();
  const listings = useListings(region.region?.id, { search, limit: 100 });

  if (region.error) {
    return <ErrorState title="Couldn't reach the store" message={region.error.message} onRetry={region.retry} />;
  }
  if (listings.error) {
    return (
      <ErrorState title="Couldn't search" message={listings.error.message} onRetry={() => void listings.refetch()} />
    );
  }
  if (!region.region || !listings.data) return <LoadingState />;

  return (
    <ShopResults
      listings={listings.data}
      currencyCode={region.region.currency_code}
      empty={
        <EmptyState
          title={`No results for “${search}”`}
          message="Check the spelling, or try fewer or shorter words."
          action={{ label: 'Clear search', onPress: onClear }}
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
        message={categories.error.message}
        onRetry={() => void categories.refetch()}
      />
    );
  }
  if (!categories.data) return <LoadingState />;

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
      contentContainerStyle={[
        { paddingHorizontal: theme.space.md, paddingBottom: theme.space.xl },
        !sections.length && styles.grow,
      ]}
      ListEmptyComponent={<EmptyState title="No categories yet" message="Search for a product by name." />}
      renderSectionHeader={({ section }) => (
        <Text variant="heading" style={{ marginTop: theme.space.lg, marginBottom: theme.space.xs }}>
          {section.title}
        </Text>
      )}
      renderItem={({ item, section }) => (
        <ListRow
          title={item.id === section.department.id ? `All ${item.name.toLowerCase()}` : item.name}
          onPress={() => openCategory(item)}
          trailing={<Text tone="secondary">›</Text>}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  field: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, paddingVertical: 0 },
  clear: { alignItems: 'center', justifyContent: 'center' },
  grow: { flexGrow: 1 },
});
