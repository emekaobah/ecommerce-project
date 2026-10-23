import { useAuth } from '@clerk/expo';
import { formatMoney, historyEntries, orderRowMeta, type HistoryEntry } from '@oja/domain';
import { Divider, EmptyState, ErrorState, OrderRow, SearchField, Skeleton, Text, useTheme, useToast } from '@oja/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOrderSearch, useOrdersInProgress, usePastOrders, type OrderGroup, type SellerOrder } from '@/api/orders';
import { orderChips } from '@/components/order-status';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { openOrderGroup } from '@/navigation';

type Entry = HistoryEntry<OrderGroup, SellerOrder>;

/** How long typing pauses before the search runs. */
const SEARCH_DELAY_MS = 300;

/**
 * The buyer's whole order history (#54): In progress, then Past, under one search across both.
 * Orders need a signed-in buyer (ADR 0001). As a tab it can't be a protected route without
 * hiding the tab, so a guest sees the way into the sign-in modal instead.
 */
export function OrdersScreen() {
  const theme = useTheme();
  const { isSignedIn, userId } = useAuth();
  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      {isSignedIn ? (
        <SignedInOrders userId={userId} />
      ) : (
        <SignInPrompt title="Your orders" message="Sign in to see and track your orders." />
      )}
    </SafeAreaView>
  );
}

/** The title, the search field (once there is an order to search) and the list or the results. */
function SignedInOrders({ userId }: Readonly<{ userId: string | null | undefined }>) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), SEARCH_DELAY_MS);
  // The same queries the list reads: with no orders at all there is nothing to search ("Orders, empty").
  const inProgress = useOrdersInProgress(userId);
  const past = usePastOrders(userId);
  const noOrders = inProgress.data?.length === 0 && past.data?.pages[0]?.order_groups.length === 0;
  return (
    <>
      <View style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[2], paddingBottom: theme.space[3], gap: theme.space[3] }}>
        <Text variant="titleRoot">Orders</Text>
        {noOrders && !query ? null : (
          <SearchField value={query} onChangeText={setQuery} placeholder="Search your orders" look="tile" />
        )}
      </View>
      {query.trim() ? <SearchResults userId={userId} q={q} /> : <OrderSections userId={userId} />}
    </>
  );
}

/** Refreshes on a pull; a failed refresh keeps the list and says so in a toast (State rules). */
function useListRefresh(refetches: readonly (() => Promise<{ isError: boolean }>)[]) {
  const toast = useToast();
  return usePullToRefresh(async () => {
    const results = await Promise.all(refetches.map((refetch) => refetch()));
    if (results.some((result) => result.isError)) toast({ message: "Couldn't refresh your orders", tone: 'problem' });
  });
}

/** In progress (whole), then Past (a page at a time as the buyer scrolls); a section with nothing in it doesn't show. */
function OrderSections({ userId }: Readonly<{ userId: string | null | undefined }>) {
  const theme = useTheme();
  const inProgress = useOrdersInProgress(userId);
  const past = usePastOrders(userId);
  const { refreshing, refresh } = useListRefresh([inProgress.refetch, past.refetch]);

  if ((inProgress.error && !inProgress.data) || (past.error && !past.data)) {
    return (
      <ErrorState
        title="Couldn't load your orders"
        body="Check your connection and try again."
        error={inProgress.error ?? past.error}
        onRetry={refresh}
      />
    );
  }
  if (!inProgress.data || !past.data) return <OrdersSkeleton />;

  const sections = [
    { title: 'In progress', data: entriesOf(inProgress.data) },
    { title: 'Past', data: entriesOf(past.data.pages.flatMap((page) => page.order_groups)) },
  ].filter((section) => section.data.length);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(entry) => entry.group.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={[{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[6] }, !sections.length && styles.grow]}
      ItemSeparatorComponent={Divider}
      keyboardShouldPersistTaps="handled"
      refreshing={refreshing}
      onRefresh={refresh}
      onEndReached={() => {
        if (past.hasNextPage && !past.isFetchingNextPage) void past.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      renderSectionHeader={({ section }) => (
        <Text variant="heading" style={{ paddingTop: theme.space[4], paddingBottom: theme.space[2] }}>
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => <HistoryRow entry={item} />}
      ListEmptyComponent={
        <EmptyState
          icon="box"
          title="No orders yet"
          body="Your orders will show up here."
          action={{ label: 'Browse shops near you', onPress: () => router.navigate('/') }}
        />
      }
      ListFooterComponent={past.hasNextPage ? <EndNote>Older orders load as you scroll.</EndNote> : undefined}
    />
  );
}

/** Checkouts with an item matching `q`, in progress or past, as one list newest first. */
function SearchResults({ userId, q }: Readonly<{ userId: string | null | undefined; q: string }>) {
  const theme = useTheme();
  const search = useOrderSearch(userId, q);
  const { refreshing, refresh } = useListRefresh([search.refetch]);

  if (search.error && !search.data) {
    return (
      <ErrorState title="Couldn't search your orders" body="Check your connection and try again." error={search.error} onRetry={refresh} />
    );
  }
  // While typing pauses, or the first page loads.
  if (!q || !search.data) return <OrdersSkeleton />;

  const entries = entriesOf(search.data.pages.flatMap((page) => page.order_groups));
  const count = search.data.pages[0]?.count ?? 0;
  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => entry.group.id}
      contentContainerStyle={[{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[6] }, !entries.length && styles.grow]}
      ItemSeparatorComponent={Divider}
      // A tap on a result opens it while the keyboard is still up, rather than only dismissing it.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshing={refreshing}
      onRefresh={refresh}
      onEndReached={() => {
        if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={
        entries.length ? (
          <Text variant="meta" tone="muted" accessibilityLiveRegion="polite" style={{ paddingBottom: theme.space[2] }}>
            {`${count} ${count === 1 ? 'order' : 'orders'} with "${q}"`}
          </Text>
        ) : undefined
      }
      ListEmptyComponent={<EmptyState icon="search" title={`No orders with "${q}"`} body="Try another item." />}
      renderItem={({ item }) => <HistoryRow entry={item} />}
    />
  );
}

const entriesOf = (groups: readonly OrderGroup[]) => historyEntries<SellerOrder, OrderGroup>(groups);

/** The buyer's time zone: a row's "Today" is their today. */
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A checkout: one shop's order on its own, or the shops' orders it was split into, each with its chips. */
function HistoryRow({ entry }: Readonly<{ entry: Entry }>) {
  const { group } = entry;
  const orders = entry.kind === 'order' ? [entry.order] : group.orders;
  const items = orders.flatMap((order) => order.items);
  const meta = orderRowMeta(
    { createdAt: group.created_at, itemCount: items.reduce((sum, item) => sum + item.quantity, 0), displayId: group.display_id },
    new Date(),
    TIME_ZONE,
  );
  return (
    <OrderRow
      title={entry.kind === 'order' ? entry.order.seller.name : `${group.orders.length} shops`}
      meta={meta}
      price={formatMoney(entry.paid_total, orders[0]?.currency_code ?? '')}
      thumbnails={items.flatMap((item) => (item.thumbnail ? [item.thumbnail] : []))}
      shops={orders.map((order) => ({
        key: order.id,
        name: entry.kind === 'group' ? order.seller.name : undefined,
        chips: orderChips(order),
      }))}
      onPress={() => openOrderGroup(group)}
    />
  );
}

function EndNote({ children }: Readonly<{ children: string }>) {
  const theme = useTheme();
  return (
    <Text variant="meta" tone="muted" style={[styles.centred, { paddingTop: theme.space[6], paddingBottom: theme.space[2] }]}>
      {children}
    </Text>
  );
}

/** Loading: order rows in outline, never a blank screen. */
function OrdersSkeleton() {
  const theme = useTheme();
  const row = { gap: theme.space[2], paddingTop: theme.space[5], paddingBottom: theme.space[6] };
  return (
    <View
      accessible
      accessibilityLabel="Loading your orders"
      style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[4] }}>
      <Skeleton width="40%" height={theme.type.heading.lineHeight} radius="pill" />
      {[0, 1, 2].map((key) => (
        <View key={key} style={[row, key > 0 && { borderTopWidth: theme.line.divider, borderTopColor: theme.colors.divider }]}>
          <Skeleton width="55%" height={theme.type.strong.lineHeight} radius="pill" />
          <Skeleton width="70%" height={theme.type.meta.lineHeight} radius="pill" />
          <View style={[styles.row, { gap: theme.space[2] }]}>
            <Skeleton width={theme.control.row} height={theme.control.row} radius="md" />
            <Skeleton width={theme.control.row} height={theme.control.row} radius="md" />
          </View>
          <Skeleton width="35%" height={theme.type.label.lineHeight + theme.space[2]} radius="pill" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  row: { flexDirection: 'row' },
  centred: { textAlign: 'center' },
});
