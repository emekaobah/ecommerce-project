import { shopStatusChip } from '@oja/domain';
import { EmptyState, ErrorState, PressableSurface, ShopHeader, Skeleton, StatusChip, Text, useTheme } from '@oja/ui';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { isNotFound } from '@/api/errors';
import { useListingResults } from '@/api/listings';
import { useShop, type Shop } from '@/api/shops';
import { ListingGrid } from '@/components/listing-grid';
import { ReviewsPreview } from '@/components/reviews';
import { RoundButton } from '@/components/round-button';
import { shopPlace, ShopStars } from '@/components/shop-facts';
import { ShopStatusNote } from '@/components/shop-status';
import { useListRefresh } from '@/hooks/use-list-refresh';
import { useLightStatusBar } from '@/hooks/use-light-status-bar';
import { useRegion } from '@/region/region-provider';

type Tab = 'products' | 'reviews';

/**
 * A shop's page: its banner and mark (the pattern and monogram without them), open state, rating,
 * distance and description, then its own products at its own prices, or its reviews.
 */
export function SellerScreen({ sellerId }: Readonly<{ sellerId: string }>) {
  const theme = useTheme();
  const region = useRegion();
  const shop = useShop(region.region?.id, sellerId);
  const listings = useListingResults(region.region?.id, { sellerId });
  const [tab, setTab] = useState<Tab>('products');
  const { refreshing, refresh } = useListRefresh(async () => {
    const [s, l] = await Promise.all([shop.refetch(), listings.refetch()]);
    return { error: s.error ?? l.error, data: s.data };
  });
  useLightStatusBar();

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
  if (shop.error && isNotFound(shop.error)) {
    return (
      <EmptyState
        title="Shop closed"
        body="This shop isn't selling in your area right now."
        icon="store"
        secondaryAction={{ label: 'Back to shops near you', onPress: () => router.navigate('/') }}
      />
    );
  }
  const error = (!shop.data && shop.error) || (!listings.data && listings.error);
  if (error) {
    return (
      <ErrorState
        title="Couldn't reach the store"
        body="Check your connection and try again. Anything in your cart is saved."
        error={error}
        onRetry={refresh}
      />
    );
  }

  const top = (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {shop.data ? <Header shop={shop.data} /> : <HeaderSkeleton />}
      <ShopTabs tab={tab} onChange={setTab} />
    </>
  );

  if (tab === 'reviews' && shop.data) {
    return (
      <ScrollView style={{ backgroundColor: theme.colors.bg }} contentContainerStyle={{ paddingBottom: theme.space[8] }}>
        {top}
        <View style={{ padding: theme.space[4] }}>
          <ReviewsPreview kind="seller" id={shop.data.id} title={shop.data.name} />
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      <ListingGrid
        listings={region.region && shop.data ? listings.data?.pages.flatMap((page) => page.listings) : undefined}
        currencyCode={region.region?.currency_code ?? ''}
        header={<View style={{ paddingBottom: theme.space[2] }}>{top}</View>}
        empty={<EmptyState title="Nothing for sale yet" body="Check back soon." icon="store" />}
        more={listings.hasNextPage}
        onEndReached={() => {
          if (listings.hasNextPage && !listings.isFetchingNextPage) void listings.fetchNextPage();
        }}
        refreshing={refreshing}
        onRefresh={refresh}
      />
    </View>
  );
}

function BackButton() {
  return <RoundButton icon="back" label="Back" onPress={() => router.back()} />;
}

function Header({ shop }: Readonly<{ shop: Shop }>) {
  const theme = useTheme();
  const place = shopPlace(shop);
  return (
    <ShopHeader name={shop.name} logoUrl={shop.logo} bannerUrl={shop.banner} actions={<BackButton />} description={shop.description}>
      <StatusChip {...shopStatusChip(shop.shop_status.state, shop.shop_status.label)} />
      <ShopStars sellerId={shop.id} />
      {place ? (
        <Text variant="meta" tone="muted">
          {place}
        </Text>
      ) : null}
      {shop.shop_status.state === 'open' ? null : (
        <View style={[styles.full, { paddingTop: theme.space[1] }]}>
          <ShopStatusNote status={shop.shop_status} />
        </View>
      )}
    </ShopHeader>
  );
}

/** The banner's place while the shop loads; back works straight away. */
function HeaderSkeleton() {
  const theme = useTheme();
  return (
    <View>
      <ShopHeader name="" actions={<BackButton />} />
      <View style={{ paddingHorizontal: theme.space[4], gap: theme.space[2], paddingBottom: theme.space[4] }}>
        <Skeleton width="60%" height={theme.space[5]} />
        <Skeleton width="80%" height={theme.space[3]} />
      </View>
    </View>
  );
}

function ShopTabs({ tab, onChange }: Readonly<{ tab: Tab; onChange: (tab: Tab) => void }>) {
  const theme = useTheme();
  const tabs: { key: Tab; label: string }[] = [
    { key: 'products', label: 'Products' },
    { key: 'reviews', label: 'Reviews' },
  ];
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.tabs,
        {
          gap: theme.space[4],
          paddingHorizontal: theme.space[4],
          borderBottomWidth: theme.line.divider,
          borderBottomColor: theme.colors.line,
          marginTop: theme.space[2],
        },
      ]}>
      {tabs.map(({ key, label }) => {
        const on = key === tab;
        return (
          <PressableSurface
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(key)}
            style={{
              minHeight: theme.hitArea,
              justifyContent: 'center',
              borderBottomWidth: theme.line.tab,
              borderBottomColor: on ? theme.colors.accent : 'transparent',
            }}>
            <Text weight="bold" tone={on ? 'default' : 'muted'}>
              {label}
            </Text>
          </PressableSurface>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  full: { width: '100%' },
  tabs: { flexDirection: 'row' },
});
