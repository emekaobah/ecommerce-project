import { categoryThumbnail, departments } from '@oja/domain';
import { EmptyState, ErrorState, Icon, PhotoTile, PressableSurface, SearchField, Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCategories, type Category } from '@/api/categories';
import { useListingResults } from '@/api/listings';
import { resultsLabel, ShopResults, ShopShelfSkeleton } from '@/components/shop-results';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { openCategory } from '@/navigation';
import { useRegion } from '@/region/region-provider';
import { useRecentSearches } from '@/search/recent-searches';

/**
 * Search by product name, results grouped by shop; with no query, recent searches and the
 * categories. A search is remembered when it's submitted or a product is opened from its
 * results, not on each keystroke.
 */
export function SearchScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim(), 300);
  const recent = useRecentSearches();
  const searchAgain = (term: string) => {
    setQuery(term);
    recent.remember(term);
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[2], paddingBottom: theme.space[2] }}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => recent.remember(query)}
          placeholder="Search products"
        />
      </View>
      {search ? (
        <Results search={search} onClear={() => setQuery('')} onOpenProduct={() => recent.remember(search)} />
      ) : (
        <Browse recent={recent.searches} onSearch={searchAgain} onClearRecent={recent.clear} />
      )}
    </SafeAreaView>
  );
}

function Results({
  search,
  onClear,
  onOpenProduct,
}: Readonly<{ search: string; onClear: () => void; onOpenProduct: () => void }>) {
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
      onOpenProduct={onOpenProduct}
      header={
        <Text
          variant="label"
          weight="extrabold"
          tone="muted"
          style={[styles.caps, { letterSpacing: theme.type.label.fontSize * CAPS_TRACKING_EM, paddingHorizontal: theme.space[4], paddingTop: theme.space[2], paddingBottom: theme.space[1] }]}>
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

/**
 * Before typing: the buyer's recent searches, then each department's sub-categories as photo
 * tiles under its heading (none for one with no sub-categories), with "See all" opening the whole department.
 */
function Browse({
  recent,
  onSearch,
  onClearRecent,
}: Readonly<{ recent: string[]; onSearch: (search: string) => void; onClearRecent: () => void }>) {
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

  const sections = departments(categories.data);
  return (
    <ScrollView
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[8] }, !sections.length && styles.grow]}>
      {recent.length ? <RecentSearches searches={recent} onSearch={onSearch} onClear={onClearRecent} /> : null}
      {sections.length ? (
        sections.map(({ department, categories: subCategories }) => (
          <View key={department.id}>
            <View style={[styles.between, { gap: theme.space[3], paddingTop: theme.space[6], paddingBottom: theme.space[3] }]}>
              <Text variant="heading" accessibilityRole="header" style={styles.fill}>
                {department.name}
              </Text>
              <SeeAll department={department} />
            </View>
            {/* A department with no sub-categories is still listed: "See all" opens its products. */}
            {subCategories.length ? <CategoryGrid categories={subCategories} /> : null}
          </View>
        ))
      ) : (
        <EmptyState title="No categories yet" body="Search for a product by name." icon="search" />
      )}
    </ScrollView>
  );
}

/** "See all": the whole department, as its category page lists it. */
function SeeAll({ department }: Readonly<{ department: Category }>) {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole="link"
      accessibilityLabel={`See all ${department.name.toLowerCase()}`}
      hitSlop={theme.space[3]}
      onPress={() => openCategory(department)}>
      <Text variant="meta" weight="bold" tone="link">
        See all
      </Text>
    </PressableSurface>
  );
}

/** A department's sub-categories, three to a row. */
function CategoryGrid({ categories }: Readonly<{ categories: Category[] }>) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const gap = theme.space[2];
  const tile = (width - theme.space[4] * 2 - gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  return (
    <View style={[styles.wrap, { columnGap: gap, rowGap: theme.space[3] }]}>
      {categories.map((category) => (
        <CategoryTile key={category.id} category={category} width={tile} />
      ))}
    </View>
  );
}

/**
 * A sub-category: its thumbnail contained on the product-tile colour, never cropped, or a plain
 * mist tile with a muted icon when an admin hasn't uploaded one; its name beneath.
 */
function CategoryTile({ category, width }: Readonly<{ category: Category; width: number }>) {
  const theme = useTheme();
  const thumbnail = categoryThumbnail(category);
  const photo = [styles.photo, { borderRadius: theme.radius.lg }];
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={category.name}
      onPress={() => openCategory(category)}
      style={{ width, gap: theme.space[2] }}>
      {thumbnail ? (
        <PhotoTile style={photo}>
          <Image source={{ uri: thumbnail }} contentFit="contain" style={styles.image} />
        </PhotoTile>
      ) : (
        <View style={[photo, { backgroundColor: theme.colors.tile }]}>
          <Icon name="bag" color={theme.colors.muted} />
        </View>
      )}
      <Text variant="meta" weight="bold" numberOfLines={2} style={styles.center}>
        {category.name}
      </Text>
    </PressableSurface>
  );
}

/** The buyer's recent searches as chips, newest first: one runs again on tap, and Clear removes them all. */
function RecentSearches({
  searches,
  onSearch,
  onClear,
}: Readonly<{ searches: string[]; onSearch: (search: string) => void; onClear: () => void }>) {
  const theme = useTheme();
  const chip = theme.space[8];
  return (
    <View style={{ paddingTop: theme.space[2] }}>
      <View style={[styles.between, { minHeight: theme.hitArea }]}>
        <Text
          variant="label"
          weight="extrabold"
          tone="muted"
          accessibilityRole="header"
          style={[styles.caps, { letterSpacing: theme.type.label.fontSize * CAPS_TRACKING_EM }]}>
          Recent searches
        </Text>
        <PressableSurface
          accessibilityRole="button"
          accessibilityLabel="Clear recent searches"
          hitSlop={theme.space[3]}
          onPress={onClear}>
          <Text variant="meta" weight="bold" tone="link">
            Clear
          </Text>
        </PressableSurface>
      </View>
      <View style={[styles.wrap, { gap: theme.space[2] }]}>
        {searches.map((search) => (
          <PressableSurface
            key={search}
            accessibilityRole="button"
            accessibilityHint="Searches again"
            onPress={() => onSearch(search)}
            style={[
              styles.chip,
              {
                minHeight: chip,
                gap: theme.space[1],
                paddingHorizontal: theme.space[3],
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.tile,
              },
            ]}>
            <Icon name="clock" use="chip" color={theme.colors.muted} />
            <Text variant="meta" weight="bold">
              {search}
            </Text>
          </PressableSurface>
        ))}
      </View>
    </View>
  );
}

/** Sub-category tiles sit three to a row, as the catalogue draws them. */
const GRID_COLUMNS = 3;

/** Caps labels track out by .06em, as the catalogue's section labels (`.lbl2`) do. */
const CAPS_TRACKING_EM = 0.06;

const styles = StyleSheet.create({
  container: { flex: 1 },
  grow: { flexGrow: 1 },
  fill: { flex: 1 },
  caps: { textTransform: 'uppercase' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center' },
  photo: { aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: '12%' },
  image: { width: '100%', height: '100%' },
  center: { textAlign: 'center' },
});
