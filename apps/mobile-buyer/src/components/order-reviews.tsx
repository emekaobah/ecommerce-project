import { isReceived, reviewAction, reviewStatus, reviewTitle } from '@oja/domain';
import { Button, StatusChip, Text, useTheme } from '@oja/ui';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import type { SellerOrder } from '@/api/orders';
import { ShopReply, Stars } from '@/components/reviews';
import { openWriteReview } from '@/navigation';

/**
 * The buyer's reviews of a shop's order (#7), each with where it is in moderation (a pending
 * one says it waits to be checked) and the shop's reply once published, named (#96); and, once the order is
 * received, a way to review it, or to edit the reviews once all are written: a buyer has one
 * review of each shop and product, whichever order they wrote it on. Beside the review button,
 * once received, Order again (#86, catalogue b-after #3): the two side by side.
 */
export function OrderReviews({
  groupId,
  order,
  onOrderAgain,
}: Readonly<{ groupId: string; order: SellerOrder; onOrderAgain: () => void }>) {
  const theme = useTheme();
  const action = reviewAction(order);
  const orderAgain = isReceived(order.fulfilment.state);
  // At the largest text sizes the two buttons stack, so neither label is squeezed.
  const stacked = useWindowDimensions().fontScale >= LARGE_TEXT;
  if (!order.reviews.length && !action && !orderAgain) return null;
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
            {review.seller_note ? <ShopReply note={review.seller_note} shop={order.seller.name} /> : null}
          </View>
        );
      })}
      {action || orderAgain ? (
        <View style={[!stacked && styles.row, { gap: theme.space[2], marginTop: theme.space[1] }]}>
          {orderAgain ? (
            <Button label="Order again" icon="refresh" size="row" onPress={onOrderAgain} style={[!stacked && styles.fill, { paddingHorizontal: theme.space[2] }]} />
          ) : null}
          {action ? (
            <Button
              label={reviewLabel(action, order.reviews.length > 0)}
              icon="star"
              variant="secondary"
              size="row"
              onPress={() => openWriteReview({ id: groupId }, order)}
              style={[!stacked && styles.fill, { paddingHorizontal: theme.space[2] }]}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** The text size (as a scale of the default) from which the two buttons stack. */
const LARGE_TEXT = 1.3;

/** What the order's review button says: edit, finish reviewing, or start. */
function reviewLabel(action: 'write' | 'edit', reviewedSome: boolean) {
  if (action === 'edit') return 'Edit your review';
  return reviewedSome ? 'Review the rest' : 'Write a review';
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
});
