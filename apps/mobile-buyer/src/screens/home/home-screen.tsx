import { useUser } from '@clerk/expo';
import { addressLines, departments, greeting, needsFirstAddress } from '@oja/domain';
import { Band, Button, EmptyState, ErrorState, FilterChips, SearchField, Skeleton, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCategories } from '@/api/categories';
import { useShops, type NearbyShop } from '@/api/shops';
import { LightStatusBar } from '@/components/light-status-bar';
import { DeliveringToPicker } from '@/components/delivering-to-picker';
import { ShopShelf, ShopShelfSkeleton } from '@/components/shop-results';
import { useAddressPrompt } from '@/delivering-to/address-prompt-provider';
import { useDeliveringTo } from '@/delivering-to/delivering-to-provider';
import { useListRefresh } from '@/hooks/use-list-refresh';
import { useRegion } from '@/region/region-provider';

const ALL = 'all';
const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Home: the band (where the buyer delivers to, a greeting and search), the store's departments as
 * chips, then shops near the buyer, nearest first, each with its top products. More shops load as
 * the buyer scrolls; after the last, a way to change the address.
 */
export function HomeScreen() {
  const theme = useTheme();
  const region = useRegion();
  const insets = useSafeAreaInsets();
  const [department, setDepartment] = useState(ALL);
  const shops = useShops(region.region?.id, department === ALL ? null : department);

  const { refreshing, refresh } = useListRefresh(shops.refetch);

  const error = region.error ?? (shops.data ? null : shops.error);
  if (error) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
        <HomeBand search={false} />
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
  const list = (currencyCode && shops.data?.pages.flatMap((page) => page.shops)) || [];
  const loaded = Boolean(currencyCode && shops.data);

  return (
    <FlatList
      data={list}
      keyExtractor={(shop) => shop.id}
      style={{ backgroundColor: theme.colors.bg }}
      // The band runs under the status bar, and the end of the list clears the tab bar (Home
      // turns off the tabs' automatic insets).
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[styles.grow, { paddingBottom: insets.bottom + theme.control.main + theme.space[4] }]}
      ListHeaderComponent={
        <>
          <HomeBand search />
          <View style={{ paddingTop: theme.space[4] }}>
            <DepartmentChips selected={department} onSelect={setDepartment} />
          </View>
          <NearYouHeading />
        </>
      }
      ListEmptyComponent={loaded ? <NoShops /> : <Loading />}
      ListFooterComponent={list.length ? <Footer more={shops.hasNextPage} /> : undefined}
      ItemSeparatorComponent={ShelfGap}
      refreshing={refreshing}
      onRefresh={refresh}
      onEndReached={() => {
        if (shops.hasNextPage && !shops.isFetchingNextPage) void shops.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      renderItem={({ item }: { item: NearbyShop }) => (
        <ShopShelf seller={item} listings={item.listings} currencyCode={currencyCode ?? ''} />
      )}
    />
  );
}

/** The indigo band under the status bar: delivering to, the greeting and search, known on the phone so never loading. */
function HomeBand({ search }: Readonly<{ search: boolean }>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  return (
    <Band style={{ paddingTop: insets.top + theme.space[1] }}>
      <LightStatusBar />
      <DeliveringToPicker />
      <Text variant="titleNamed" tone="onBand">
        {`${greeting(new Date(), user?.firstName ?? null, deviceTimeZone)}\nWhat are we buying?`}
      </Text>
      {search ? (
        <SearchField
          value=""
          onChangeText={() => undefined}
          placeholder="Search products"
          editable={false}
          onPress={() => router.navigate('/search')}
        />
      ) : null}
    </Band>
  );
}

/** "All", then the store's departments by name: categories carry no images. */
function DepartmentChips({ selected, onSelect }: Readonly<{ selected: string; onSelect: (id: string) => void }>) {
  const theme = useTheme();
  const categories = useCategories();
  if (!categories.data) {
    return (
      <View style={[styles.row, { gap: theme.space[2], paddingHorizontal: theme.space[4] }]}>
        {[0.45, 0.85, 0.8, 0.7].map((width) => (
          <Skeleton key={width} width={theme.block.railTile * width} height={theme.space[8]} radius="md" />
        ))}
      </View>
    );
  }
  const options = [
    { id: ALL, label: 'All' },
    ...departments(categories.data).map(({ department }) => ({ id: department.id, label: department.name })),
  ];
  return <FilterChips options={options} selected={selected} onSelect={onSelect} label="Categories" />;
}

/** "Near you", and "Nearest first" once shops are measured from an address or a guest's spot. */
function NearYouHeading() {
  const theme = useTheme();
  const { address, near } = useDeliveringTo();
  return (
    <View
      style={[styles.between, { paddingHorizontal: theme.space[4], paddingTop: theme.space[6], paddingBottom: theme.space[1] }]}>
      <Text variant="heading">Near you</Text>
      {address || near ? (
        <Text variant="meta" weight="bold" tone="link">
          Nearest first
        </Text>
      ) : null}
    </View>
  );
}

/** Shelves are separated by space alone, as the catalogue draws them. */
function ShelfGap() {
  const theme = useTheme();
  return <View style={{ height: theme.space[6] }} />;
}

function Loading() {
  return (
    <View accessible accessibilityLabel="Loading shops near you">
      <ShopShelfSkeleton />
      <ShopShelfSkeleton />
    </View>
  );
}

/** No shops to show; a buyer without a saved address is asked for one, since shops are measured from it. */
function NoShops() {
  const { address, saved, signedIn, error, near } = useDeliveringTo();
  const prompt = useAddressPrompt();
  if (needsFirstAddress({ address, saved, signedIn, error: !!error, spot: near })) {
    return (
      <EmptyState
        title="No shops yet"
        body="Shops near you will show here once you add a delivery address."
        icon="store"
        action={{ label: 'Add a delivery address', onPress: prompt.open }}
      />
    );
  }
  return <EmptyState title="No shops yet" body="Shops selling in your area will show up here." icon="store" />;
}

/** More shops loading, or after the last one, the way to change the address they're measured from. */
function Footer({ more }: Readonly<{ more: boolean }>) {
  const theme = useTheme();
  const { address } = useDeliveringTo();
  if (more) return <ShopShelfSkeleton />;
  if (!address) return null;
  return (
    <View style={[styles.center, { paddingTop: theme.space[6], paddingBottom: theme.space[8], paddingHorizontal: theme.space[4] }]}>
      <Text variant="meta" tone="muted" style={styles.centerText}>
        {`That's every shop near ${address.address_1 ?? addressLines(address).place}.`}
      </Text>
      <Button label="Change address" variant="link" onPress={() => router.push('/delivering-to')} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  row: { flexDirection: 'row', overflow: 'hidden' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
});
