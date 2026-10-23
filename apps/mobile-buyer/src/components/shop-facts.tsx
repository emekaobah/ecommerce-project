import { distanceLabel } from '@oja/domain';
import { Icon, Text, useTheme } from '@oja/ui';
import { StyleSheet, View } from 'react-native';

import { useReviewPreview } from '@/api/reviews';

/** "Surulere · 1 km": where the shop is and how far, from the address the buyer delivers to (#43). */
export function shopPlace(seller: { area: string | null; distance_km: number | null }): string | null {
  const facts = [seller.area, seller.distance_km == null ? null : distanceLabel(seller.distance_km)].filter(Boolean);
  return facts.length ? facts.join(' · ') : null;
}

/** A shop's rating as "★ 4.8 (212)"; nothing until it loads, or before its first review. */
export function ShopStars({ sellerId, count = true }: Readonly<{ sellerId: string; count?: boolean }>) {
  const theme = useTheme();
  const { data } = useReviewPreview('seller', sellerId);
  if (data?.average_rating == null) return null;
  const average = data.average_rating.toFixed(1);
  return (
    <View
      accessible
      accessibilityLabel={`Rated ${average} out of 5, ${data.count} ${data.count === 1 ? 'review' : 'reviews'}`}
      style={[styles.row, { gap: theme.space[1] }]}>
      <Icon name="star" use="chip" color={theme.colors.accent} filled />
      <Text variant="meta" tone="muted">
        {count ? `${average} (${data.count})` : average}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
