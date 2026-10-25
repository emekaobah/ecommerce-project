import { dateLabel, ratingSummary, shopInitials, type Rating, type ReviewKind } from '@oja/domain';
import { Button, GroupList, Icon, PressableSurface, Skeleton, Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { REVIEW_PREVIEW_COUNT, useReviewPreview, type PublishedReview } from '@/api/reviews';
import { openReviews } from '@/navigation';

const MAX_STARS = 5;

const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** When a review was written, as its card shows it: "12 Oct", on the buyer's calendar. */
export function reviewDate(at: string | Date): string {
  return dateLabel(at, DEVICE_TIME_ZONE, { weekday: false });
}

/** A rating out of five as stars, read out as a number; half a star or more rounds up. */
export function Stars({ rating }: Readonly<{ rating: number }>) {
  const theme = useTheme();
  const filled = Math.round(rating);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${rating.toFixed(1)} out of ${MAX_STARS} stars`}
      style={[styles.row, { gap: theme.space[1] / 2 }]}>
      {Array.from({ length: MAX_STARS }, (_, i) => (
        <Icon key={i} name="star" use="chip" color={i < filled ? theme.colors.accent : theme.colors.line} solid />
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
      <Text variant="meta" tone="muted">
        {ratingSummary(rating)}
      </Text>
    </View>
  );
}

/** A shop's rating from its published reviews, for wherever the shop is named; nothing until it loads. */
export function ShopRating({ sellerId }: Readonly<{ sellerId: string }>) {
  const { data } = useReviewPreview('seller', sellerId);
  if (!data) return null;
  return <RatingLine rating={{ average: data.average_rating, count: data.count }} />;
}

/** Tap a star to rate one to five; each star is its own button, large enough to hit. */
export function StarInput({
  value,
  onChange,
  label,
}: Readonly<{ value: number; onChange: (rating: number) => void; label: string }>) {
  const theme = useTheme();
  return (
    <View style={[styles.row, styles.centre]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {Array.from({ length: MAX_STARS }, (_, i) => i + 1).map((star) => (
        <PressableSurface
          key={star}
          accessibilityRole="radio"
          accessibilityLabel={`${star} ${star === 1 ? 'star' : 'stars'}`}
          accessibilityState={{ selected: value === star }}
          onPress={() => onChange(star)}
          style={[styles.star, { minWidth: theme.hitArea, minHeight: theme.hitArea, borderRadius: theme.radius.md }]}>
          <Icon name="star" use="quietEmblem" color={star <= value ? theme.colors.accent : theme.colors.line} solid />
        </PressableSurface>
      ))}
    </View>
  );
}

/**
 * A published review: who wrote it and when, its stars, what they said, and the reply of the shop
 * it was bought from under it, named (#96). Lists put a `Divider` between reviews, never above the
 * first.
 */
export function ReviewItem({ review }: Readonly<{ review: PublishedReview }>) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2], paddingVertical: theme.space[4] }}>
      <View style={[styles.row, styles.between, { gap: theme.space[2] }]}>
        <Text variant="meta" weight="bold" style={styles.shrink}>
          {review.author}
        </Text>
        <Text variant="meta" tone="muted">
          {reviewDate(review.created_at)}
        </Text>
      </View>
      <Stars rating={review.rating} />
      {review.customer_note ? <Text>{review.customer_note}</Text> : null}
      {review.seller_note ? <ShopReply note={review.seller_note} shop={review.shop?.name} /> : null}
    </View>
  );
}

/** The shop's public reply, set in under the review it answers: "Iya Bisi Foodstuff replied: …". */
export function ShopReply({ note, shop }: Readonly<{ note: string; shop?: string }>) {
  const theme = useTheme();
  return (
    <View style={{ marginLeft: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.tile }}>
      <Text variant="meta" tone="muted" style={{ lineHeight: theme.type.meta.fontSize * 1.5 }}>
        <Text variant="meta" weight="bold">{`${shop ?? 'The shop'} replied:`}</Text> {note}
      </Text>
    </View>
  );
}

/**
 * What a review is of, as its card heads it: the product's photo or the shop's mark, its name
 * and a line under it ("Iya Bisi Foodstuff", or "Shop"). `trailing` sits at the end, e.g. a menu.
 */
export function ReviewSubjectLine({
  title,
  detail,
  thumbnail,
  shop,
  trailing,
  large,
}: Readonly<{
  title: string;
  detail?: string | null;
  thumbnail?: string | null;
  shop?: { name: string; logo?: string | null };
  trailing?: ReactNode;
  /** Heading the review being written: a bigger photo and name (the catalogue's `.ln`). */
  large?: boolean;
}>) {
  const theme = useTheme();
  const size = theme.shopMark.sm.size * ((large ? 48 : 36) / 32);
  const box = { width: size, height: size, borderRadius: theme.radius.md, overflow: 'hidden' as const };
  return (
    <View style={[styles.row, { gap: theme.space[2] }]}>
      {shop ? (
        <SubjectMonogram shop={shop} style={box} />
      ) : (
        <View style={[box, { backgroundColor: theme.colors.productTile }]}>
          {thumbnail ? <Image source={thumbnail} contentFit="contain" style={styles.fill} accessibilityIgnoresInvertColors /> : null}
        </View>
      )}
      <View style={styles.fill}>
        <Text variant={large ? 'body' : 'meta'} weight="bold" numberOfLines={2}>
          {title}
        </Text>
        {detail ? (
          <Text variant="meta" tone="muted" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

/**
 * A reviewed shop beside its review, the same size as a product's photo: its logo, or its
 * initials on plain indigo (the catalogue's `.mono`, no pattern at this size).
 */
function SubjectMonogram({ shop, style }: Readonly<{ shop: { name: string; logo?: string | null }; style: ViewStyle }>) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  if (shop.logo && !failed) {
    return (
      <View style={[style, { backgroundColor: theme.colors.productTile }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Image source={{ uri: shop.logo }} contentFit="cover" style={styles.fill} onError={() => setFailed(true)} />
      </View>
    );
  }
  return (
    <View
      style={[style, styles.star, { backgroundColor: theme.colors.band }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {/* Bricolage at the meta size, sized by its box so it doesn't grow with the text setting. */}
      <Text
        variant="heading"
        weight="extrabold"
        tone="onBand"
        maxFontSizeMultiplier={1}
        style={{ fontSize: theme.type.meta.fontSize, lineHeight: theme.type.meta.lineHeight }}>
        {shopInitials(shop.name)}
      </Text>
    </View>
  );
}

/** The shape of a few reviews while they load. */
export function ReviewsSkeleton({ count = 3 }: Readonly<{ count?: number }>) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel="Loading reviews">
      <GroupList>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={{ gap: theme.space[2], paddingVertical: theme.space[4] }}>
            <Skeleton width="40%" height={theme.type.meta.lineHeight} />
            <Skeleton width="25%" height={theme.type.meta.lineHeight} />
            <Skeleton width="90%" height={theme.type.body.lineHeight} />
          </View>
        ))}
      </GroupList>
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
    if (preview.error && !preview.data) {
      return (
        <View style={{ gap: theme.space[1], alignItems: 'flex-start' }}>
          <Text tone="muted">{"Couldn't load the reviews."}</Text>
          <Button label="Try again" variant="link" onPress={() => void preview.refetch()} style={styles.inlineLink} />
        </View>
      );
    }
    if (!preview.data) return <ReviewsSkeleton count={2} />;
    const { reviews, average_rating, count } = preview.data;
    return (
      <>
        <RatingLine rating={{ average: average_rating, count }} />
        <GroupList>
          {reviews.map((review) => (
            <ReviewItem key={review.id} review={review} />
          ))}
        </GroupList>
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
  fill: { flex: 1 },
  between: { justifyContent: 'space-between' },
  centre: { justifyContent: 'center' },
  shrink: { flexShrink: 1 },
  star: { alignItems: 'center', justifyContent: 'center' },
  inlineLink: { paddingHorizontal: 0, alignSelf: 'flex-start' },
});
