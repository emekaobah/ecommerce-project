import { reviewStatus, reviewTargets } from '@oja/domain';
import { Button, StatusChip, Text, useTheme } from '@oja/ui';
import { View } from 'react-native';

import type { SellerOrder } from '@/api/orders';
import { ShopReply, Stars } from '@/components/reviews';
import { openWriteReview } from '@/navigation';

type OrderReview = SellerOrder['reviews'][number];

/** What a review on the order is of, as the order names it. */
function titleOf(order: SellerOrder, review: OrderReview) {
  if (review.reference === 'seller') return order.seller.name;
  return order.items.find((i) => i.product_id === review.reference_id)?.product_title ?? 'Product';
}

/**
 * The buyer's reviews of a shop's order (#7), each with where it is in moderation (a pending
 * one says it waits to be checked) and the shop's reply once published; and, once the order is
 * received, a way to review what they haven't yet.
 */
export function OrderReviews({ groupId, order }: Readonly<{ groupId: string; order: SellerOrder }>) {
  const theme = useTheme();
  const toReview = order.can_review ? reviewTargets(order) : [];
  if (!order.reviews.length && !toReview.length) return null;
  return (
    <View style={{ gap: theme.space.sm }}>
      {order.reviews.length ? <Text variant="label">Your reviews</Text> : null}
      {order.reviews.map((review) => {
        const status = reviewStatus(review.status);
        return (
          <View key={review.id} style={{ gap: theme.space.xs }}>
            <Text>{titleOf(order, review)}</Text>
            <Stars rating={review.rating} />
            {review.customer_note ? <Text tone="secondary">{review.customer_note}</Text> : null}
            <StatusChip label={status.label} tone={status.tone} />
            {status.note ? (
              <Text variant="caption" tone="secondary">
                {status.note}
              </Text>
            ) : null}
            {review.seller_note ? <ShopReply note={review.seller_note} /> : null}
          </View>
        );
      })}
      {toReview.length ? (
        <Button
          label={order.reviews.length ? 'Review the rest' : 'Review this order'}
          variant="secondary"
          onPress={() => openWriteReview({ id: groupId }, order)}
        />
      ) : null}
    </View>
  );
}
