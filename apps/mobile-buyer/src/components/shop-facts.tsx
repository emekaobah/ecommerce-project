import { shipsIn } from '@oja/domain';
import { Text, type TextProps } from '@oja/ui';

import type { Listing } from '@/api/listings';

/** A shop header's facts line, "Surulere · Ships in 2 days", the same wherever the shop appears. */
export function ShopFacts({
  seller,
  variant,
}: Readonly<{ seller: Pick<Listing['seller'], 'area' | 'default_leadtime_to_ship'>; variant?: TextProps['variant'] }>) {
  const facts = [
    seller.area,
    seller.default_leadtime_to_ship == null ? null : shipsIn(seller.default_leadtime_to_ship),
  ].filter(Boolean);
  if (!facts.length) return null;
  return (
    <Text variant={variant} tone="secondary">
      {facts.join(' · ')}
    </Text>
  );
}
