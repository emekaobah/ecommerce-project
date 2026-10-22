import { reviewAction, reviewStatus, reviewTitle } from '@oja/domain';
import { Button, StatusChip, Text, useTheme } from '@oja/ui';
import { View } from 'react-native';

import type { SellerOrder } from '@/api/orders';
import { ShopReply, Stars } from '@/components/reviews';
import { openWriteReview } from '@/navigation';

/**
 * The buyer's reviews of a shop's order (#7), each with where it is in moderation (a pending
 * one says it waits to be checked) and the shop's reply once published; and, once the order is
 * received, a way to review it, or to edit the reviews once all are written: a buyer has one
 * review of each shop and product, whichever order they wrote it on.
 */
export function OrderReviews({ groupId, order }: Readonly<{ groupId: string; order: SellerOrder }>) {
  const theme = useTheme();
  const action = reviewAction(order);
  if (!order.reviews.length && !action) return null;
  return (
    <View style={{ gap: theme.space[2] }}>
      {order.reviews.length ? <Text variant="strong">Your reviews</Text> : null}
      {order.reviews.map((review) => {
        const status = reviewStatus(review.status);
        return (
          <View key={review.id} style={{ gap: theme.space[1] }}>
            <Text>{reviewTitle(order, review)}</Text>
            <Stars rating={review.rating} />
            {review.customer_note ? <Text tone="muted">{review.customer_note}</Text> : null}
            <StatusChip label={status.label} tone={status.tone} icon={status.icon} />
            {status.note ? (
              <Text variant="meta" tone="muted">
                {status.note}
              </Text>
            ) : null}
            {review.seller_note ? <ShopReply note={review.seller_note} /> : null}
          </View>
        );
      })}
      {action ? (
        <Button
          label={reviewLabel(action, order.reviews.length > 0)}
          variant="secondary"
          onPress={() => openWriteReview({ id: groupId }, order)}
        />
      ) : null}
    </View>
  );
}

/** What the order's review button says: edit, finish reviewing, or start. */
function reviewLabel(action: 'write' | 'edit', reviewedSome: boolean) {
  if (action === 'edit') return 'Edit your review';
  return reviewedSome ? 'Review the rest' : 'Review this order';
}
