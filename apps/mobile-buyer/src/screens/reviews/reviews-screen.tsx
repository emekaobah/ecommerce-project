import type { ReviewKind } from '@oja/domain';
import { EmptyState, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import { Stack } from 'expo-router';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { useReviewPages } from '@/api/reviews';
import { RatingLine, ReviewItem } from '@/components/reviews';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';

/** Every published review of a shop or product, newest first, under its rating. */
export function ReviewsScreen({ kind, id, title }: Readonly<{ kind: ReviewKind; id: string; title: string }>) {
  const theme = useTheme();
  const pages = useReviewPages(kind, id);
  const { refreshing, refresh } = usePullToRefresh(() => pages.refetch());

  if (pages.error && !pages.data) {
    return <ErrorState title="Couldn't load the reviews" message={pages.error.message} onRetry={refresh} />;
  }
  if (!pages.data) return <LoadingState />;

  const [first] = pages.data.pages;
  const reviews = pages.data.pages.flatMap((page) => page.reviews);
  return (
    <>
      <Stack.Screen options={{ title: `Reviews of ${title}` }} />
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
        ListHeaderComponent={
          first ? (
            <View style={{ gap: theme.space[1], paddingVertical: theme.space[4] }}>
              <Text variant="titleNamed">{title}</Text>
              <RatingLine rating={{ average: first.average_rating, count: first.count }} />
            </View>
          ) : undefined
        }
        ListEmptyComponent={<EmptyState title="No reviews yet" message="Reviews show here once they're published." />}
        ListFooterComponent={
          pages.isFetchingNextPage ? <ActivityIndicator color={theme.colors.ink} accessibilityLabel="Loading" /> : undefined
        }
        renderItem={({ item }) => <ReviewItem review={item} />}
      />
    </>
  );
}
