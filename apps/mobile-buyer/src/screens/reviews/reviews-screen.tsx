import type { ReviewKind } from '@oja/domain';
import { Divider, EmptyState, ErrorState, Skeleton, Text, useTheme, useToast } from '@oja/ui';
import { FlatList, StyleSheet, View } from 'react-native';

import { useReviewPages, type PublishedReviews } from '@/api/reviews';
import { ReviewItem, ReviewsSkeleton, Stars } from '@/components/reviews';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';

/**
 * Every published review of a shop or product, newest first, under their average and count.
 * A product's are of the catalogue product, so they count across every shop that sells it.
 */
export function ReviewsScreen({ kind, id, title }: Readonly<{ kind: ReviewKind; id: string; title: string }>) {
  const theme = useTheme();
  const toast = useToast();
  const pages = useReviewPages(kind, id);
  const { refreshing, refresh } = usePullToRefresh(async () => {
    const result = await pages.refetch();
    if (result.isError) toast({ message: "Couldn't refresh the reviews", tone: 'problem' });
  });

  if (pages.error && !pages.data) {
    return (
      <ErrorState
        title="Couldn't load the reviews"
        body="Check your connection and try again."
        error={pages.error}
        onRetry={() => void pages.refetch()}
      />
    );
  }

  const first = pages.data?.pages[0];
  const reviews = pages.data?.pages.flatMap((page) => page.reviews) ?? [];
  return (
    <FlatList
      data={reviews}
      keyExtractor={(review) => review.id}
      style={{ backgroundColor: theme.colors.bg }}
      contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[12], flexGrow: 1 }}
      refreshing={refreshing}
      onRefresh={refresh}
      onEndReached={() => {
        if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage();
      }}
      ListHeaderComponent={first ? <RatingSummary rating={first} title={title} /> : <SummarySkeleton />}
      ListEmptyComponent={
        pages.data ? (
          <EmptyState icon="star" title="No reviews yet" body="Reviews show here once they're published." />
        ) : (
          <ReviewsSkeleton />
        )
      }
      ItemSeparatorComponent={Divider}
      ListFooterComponent={
        pages.isFetchingNextPage ? (
          <>
            <Divider />
            <ReviewsSkeleton count={1} />
          </>
        ) : undefined
      }
      renderItem={({ item }) => <ReviewItem review={item} />}
    />
  );
}

/** The big average, then its stars and how many reviews it's of, stacked: "4.7 / ★★★★★ / 38 reviews". */
function RatingSummary({ rating, title }: Readonly<{ rating: PublishedReviews; title: string }>) {
  const theme = useTheme();
  if (rating.average_rating == null || !rating.count) return null;
  const count = `${rating.count} ${rating.count === 1 ? 'review' : 'reviews'}`;
  return (
    <View
      accessible
      accessibilityLabel={`${title}: ${rating.average_rating.toFixed(1)} out of 5 stars, ${count}`}
      style={[styles.summary, { gap: theme.space[1], paddingTop: theme.space[2], paddingBottom: theme.space[4] }]}>
      <Text variant="displayXxl">{rating.average_rating.toFixed(1)}</Text>
      <Stars rating={rating.average_rating} />
      <Text variant="meta" tone="muted">
        {count}
      </Text>
    </View>
  );
}

function SummarySkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.summary, { gap: theme.space[1], paddingTop: theme.space[2], paddingBottom: theme.space[4] }]}>
      <Skeleton width={theme.type.displayXxl.fontSize * 1.6} height={theme.type.displayXxl.lineHeight} />
      <Skeleton width="30%" height={theme.type.meta.lineHeight} />
      <Skeleton width="25%" height={theme.type.meta.lineHeight} />
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { alignItems: 'flex-start' },
});
