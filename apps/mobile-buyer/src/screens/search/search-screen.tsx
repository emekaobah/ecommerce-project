import { departments } from '@oja/domain';
import { EmptyState, ErrorState, ListRow, LoadingState, MAX_FONT_SCALE, Text, useTheme } from '@oja/ui';
import { useState } from 'react';
import { Pressable, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCategories } from '@/api/categories';
import { useListings } from '@/api/listings';
import { DeliveringToPicker } from '@/components/delivering-to-picker';
import { ShopResults } from '@/components/shop-results';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { openCategory } from '@/navigation';
import { useRegion } from '@/region/region-provider';

/** Search by product name; with no query, browse by category. */
export function SearchScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim(), 300);

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <View style={{ paddingHorizontal: theme.space[4], paddingVertical: theme.space[4], gap: theme.space[4] }}>
        <Text variant="titleRoot">Search</Text>
        <DeliveringToPicker />
        <View
          style={[
            styles.field,
            {
              minHeight: theme.hitArea,
              backgroundColor: theme.colors.tile,
              borderRadius: theme.radius.md,
              paddingLeft: theme.space[4],
            },
          ]}>
          <TextInput
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            value={query}
            onChangeText={setQuery}
            placeholder="Search products"
            placeholderTextColor={theme.colors.muted}
            accessibilityLabel="Search products"
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="never"
            style={[styles.input, theme.type.body, { color: theme.colors.ink }]}
          />
          {query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              style={[styles.clear, { minWidth: theme.hitArea, minHeight: theme.hitArea }]}>
              <Text tone="muted">✕</Text>
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
    return <ErrorState title="Couldn't reach the store" body="Check your connection and try again. Anything in your cart is saved." error={region.error} onRetry={region.retry} />;
  }
  if (listings.error) {
    return (
      <ErrorState title="Couldn't search" body="Check your connection and try again." error={listings.error} onRetry={() => void listings.refetch()} />
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
          body="Check the spelling, or try fewer or shorter words."
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
        body="Check your connection and try again." error={categories.error}
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
        { paddingHorizontal: theme.space[4], paddingBottom: theme.space[8] },
        !sections.length && styles.grow,
      ]}
      ListEmptyComponent={<EmptyState title="No categories yet" body="Search for a product by name." />}
      renderSectionHeader={({ section }) => (
        <Text variant="heading" style={{ marginTop: theme.space[6], marginBottom: theme.space[1] }}>
          {section.title}
        </Text>
      )}
      renderItem={({ item, section }) => (
        <ListRow
          title={item.id === section.department.id ? `All ${item.name.toLowerCase()}` : item.name}
          onPress={() => openCategory(item)}
          trailing={<Text tone="muted">›</Text>}
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
