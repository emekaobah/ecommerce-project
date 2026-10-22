import { distanceLabel, shipsIn } from '@oja/domain';
import { Text, type TextProps } from '@oja/ui';

import type { Listing } from '@/api/listings';

/**
 * A shop header's facts line, "Surulere · 3 km · Ships in 2 days", the same wherever the shop
 * appears. The distance is from the address the buyer delivers to, when they have one (#43).
 */
export function ShopFacts({
  seller,
  variant,
}: Readonly<{
  seller: Pick<Listing['seller'], 'area' | 'distance_km' | 'default_leadtime_to_ship'>;
  variant?: TextProps['variant'];
}>) {
  const facts = [
    seller.area,
    seller.distance_km == null ? null : distanceLabel(seller.distance_km),
    seller.default_leadtime_to_ship == null ? null : shipsIn(seller.default_leadtime_to_ship),
  ].filter(Boolean);
  if (!facts.length) return null;
  return (
    <Text variant={variant} tone="muted">
      {facts.join(' · ')}
    </Text>
  );
}
