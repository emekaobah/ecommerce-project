import type { ReviewKind } from '@oja/domain';
import { EmptyState, ErrorState, Skeleton, Text, useTheme, useToast } from '@oja/ui';
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
      ListFooterComponent={pages.isFetchingNextPage ? <ReviewsSkeleton count={1} /> : undefined}
      renderItem={({ item }) => <ReviewItem review={item} shop={kind === 'seller' ? title : undefined} />}
    />
  );
}

/** The big average, its stars and how many reviews it's of: "4.7 ★★★★★ 38 reviews". */
function RatingSummary({ rating, title }: Readonly<{ rating: PublishedReviews; title: string }>) {
  const theme = useTheme();
  if (rating.average_rating == null || !rating.count) return null;
  const count = `${rating.count} ${rating.count === 1 ? 'review' : 'reviews'}`;
  return (
    <View
      accessible
      accessibilityLabel={`${title}: ${rating.average_rating.toFixed(1)} out of 5 stars, ${count}`}
      style={[styles.summary, { gap: theme.space[4], paddingTop: theme.space[2], paddingBottom: theme.space[3] }]}>
      <Text variant="displayXxl">{rating.average_rating.toFixed(1)}</Text>
      <View style={{ gap: theme.space[1] }}>
        <Stars rating={rating.average_rating} />
        <Text variant="meta" tone="muted">
          {count}
        </Text>
      </View>
    </View>
  );
}

function SummarySkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.summary, { gap: theme.space[4], paddingTop: theme.space[2], paddingBottom: theme.space[3] }]}>
      <Skeleton width={theme.type.displayXxl.fontSize * 1.6} height={theme.type.displayXxl.lineHeight} />
      <View style={{ gap: theme.space[1], flex: 1 }}>
        <Skeleton width="40%" height={theme.type.meta.lineHeight} />
        <Skeleton width="30%" height={theme.type.meta.lineHeight} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center' },
});
