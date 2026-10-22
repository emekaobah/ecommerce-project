import { ratingSummary, type Rating, type ReviewKind } from '@oja/domain';
import { Button, Icon, Text, useTheme } from '@oja/ui';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { REVIEW_PREVIEW_COUNT, useReviewPreview, type PublishedReview } from '@/api/reviews';
import { openReviews } from '@/navigation';

const MAX_STARS = 5;

/** A rating out of five as stars, read out as a number; half a star or more rounds up. */
export function Stars({ rating }: Readonly<{ rating: number }>) {
  const theme = useTheme();
  const filled = Math.round(rating);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${rating.toFixed(1)} out of ${MAX_STARS} stars`}
      style={styles.row}>
      {Array.from({ length: MAX_STARS }, (_, i) => (
        <Icon key={i} name="star" use="chip" color={i < filled ? theme.colors.accent : theme.colors.line} filled />
      ))}
    </View>
  );
}

/** A shop's or product's rating on one line: stars and "4.3 · 12 reviews", or "No reviews yet". */
export function RatingLine({ rating }: Readonly<{ rating: Rating }>) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { gap: theme.space[1] }]}>
      {rating.average != null ? <Stars rating={rating.average} /> : null}
      <Text tone="muted">{ratingSummary(rating)}</Text>
    </View>
  );
}

/** A shop's rating from its published reviews, for wherever the shop is named; nothing until it loads. */
export function ShopRating({ sellerId }: Readonly<{ sellerId: string }>) {
  const { data } = useReviewPreview('seller', sellerId);
  if (!data) return null;
  return <RatingLine rating={{ average: data.average_rating, count: data.count }} />;
}

/** Tap a star to rate one to five; each star is its own button. */
export function StarInput({
  value,
  onChange,
  label,
}: Readonly<{ value: number; onChange: (rating: number) => void; label: string }>) {
  const theme = useTheme();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {Array.from({ length: MAX_STARS }, (_, i) => i + 1).map((star) => (
        <Pressable
          key={star}
          accessibilityRole="radio"
          accessibilityLabel={`${star} ${star === 1 ? 'star' : 'stars'}`}
          accessibilityState={{ selected: value === star }}
          onPress={() => onChange(star)}
          style={[styles.star, { minWidth: theme.hitArea, minHeight: theme.hitArea }]}>
          <Icon name="star" color={star <= value ? theme.colors.accent : theme.colors.line} filled />
        </Pressable>
      ))}
    </View>
  );
}

/** A published review: its stars, who wrote it and when, what they said, and the shop's reply under it. */
export function ReviewItem({ review }: Readonly<{ review: PublishedReview }>) {
  const theme = useTheme();
  const date = new Date(review.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' });
  return (
    <View
      style={{
        gap: theme.space[1],
        paddingVertical: theme.space[4],
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.line,
      }}>
      <Stars rating={review.rating} />
      <Text variant="meta" tone="muted">{`${review.author} · ${date}`}</Text>
      {review.customer_note ? <Text>{review.customer_note}</Text> : null}
      {review.seller_note ? <ShopReply note={review.seller_note} /> : null}
    </View>
  );
}

/** The shop's reply, set under the review it answers. */
export function ShopReply({ note }: Readonly<{ note: string }>) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.space[1],
        marginTop: theme.space[1],
        padding: theme.space[2],
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.tile,
      }}>
      <Text variant="strong">Reply from the shop</Text>
      <Text>{note}</Text>
    </View>
  );
}

/**
 * A page's reviews section: the rating, the newest few published reviews and "See all". Loads
 * on its own, so the page shows without waiting for it.
 */
export function ReviewsPreview({ kind, id, title }: Readonly<{ kind: ReviewKind; id: string; title: string }>) {
  const theme = useTheme();
  const preview = useReviewPreview(kind, id);

  const body = () => {
    if (preview.error) {
      return (
        <View style={{ gap: theme.space[1], alignItems: 'flex-start' }}>
          <Text tone="muted">{"Couldn't load the reviews."}</Text>
          <Button label="Try again" variant="link" onPress={() => void preview.refetch()} style={styles.inlineLink} />
        </View>
      );
    }
    if (!preview.data) return <ActivityIndicator color={theme.colors.ink} accessibilityLabel="Loading reviews" />;
    const { reviews, average_rating, count } = preview.data;
    return (
      <>
        <RatingLine rating={{ average: average_rating, count }} />
        {reviews.map((review) => (
          <ReviewItem key={review.id} review={review} />
        ))}
        {count > REVIEW_PREVIEW_COUNT ? (
          <Button
            label={`See all ${count} reviews`}
            variant="link"
            onPress={() => openReviews(kind, id, title)}
            style={styles.inlineLink}
          />
        ) : null}
      </>
    );
  };

  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="heading">Reviews</Text>
      {body()}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  star: { alignItems: 'center', justifyContent: 'center' },
  inlineLink: { paddingHorizontal: 0, alignSelf: 'flex-start' },
});
