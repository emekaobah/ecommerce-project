import { useAuth } from '@clerk/expo';
import { reviewTargets, type ReviewTarget } from '@oja/domain';
import { Button, EmptyState, ErrorState, LoadingState, Text, useTheme } from '@oja/ui';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { useOrderGroup, type SellerOrder } from '@/api/orders';
import { useSubmitReviews, type ReviewDraft } from '@/api/reviews';
import { StarInput } from '@/components/reviews';

/** Mercur keeps a review's note to 300 characters. */
const NOTE_LIMIT = 300;

type Draft = { rating: number; note: string };
const key = (t: Pick<ReviewTarget, 'reference' | 'reference_id'>) => `${t.reference}:${t.reference_id}`;

/**
 * Reviewing a received shop's order (#7): the shop and each product on it, each rated from one
 * to five with an optional note. Only what the buyer rates is sent; each waits for moderation.
 */
export function WriteReviewScreen({ groupId, orderId }: Readonly<{ groupId: string; orderId: string }>) {
  const { userId } = useAuth();
  const group = useOrderGroup(userId, groupId);

  if (group.error && !group.data) {
    return <ErrorState title="Couldn't load this order" message={group.error.message} onRetry={() => void group.refetch()} />;
  }
  if (!group.data) return <LoadingState />;
  const order = group.data.orders.find((o) => o.id === orderId);
  const targets = order ? reviewTargets(order) : [];
  if (!order || !order.can_review || !targets.length) {
    return (
      <EmptyState
        title={order?.can_review ? 'All reviewed' : 'Not ready for review'}
        message={
          order?.can_review
            ? "You've reviewed everything on this order."
            : 'You can review an order once you have received it.'
        }
        action={{ label: 'Back to the order', onPress: () => router.back() }}
      />
    );
  }
  return <ReviewForm order={order} targets={targets} />;
}

function ReviewForm({ order, targets }: Readonly<{ order: SellerOrder; targets: ReviewTarget[] }>) {
  const theme = useTheme();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const submit = useSubmitReviews();
  const draftOf = (t: ReviewTarget): Draft => drafts[key(t)] ?? { rating: 0, note: '' };
  const update = (t: ReviewTarget, change: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [key(t)]: { ...draftOf(t), ...change } }));

  const rated: ReviewDraft[] = targets.flatMap((t) => {
    const { rating, note } = draftOf(t);
    return rating ? [{ reference: t.reference, reference_id: t.reference_id, rating, customer_note: note.trim() || null }] : [];
  });

  return (
    <>
      <Stack.Screen options={{ title: `Review ${order.seller.name}` }} />
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg, paddingBottom: theme.space.xxl }}
        keyboardShouldPersistTaps="handled">
        <Text tone="secondary">
          {"Rate what you'd like to. We check every review before it's published, so other buyers see it once it is."}
        </Text>
        {targets.map((target) => (
          <TargetReview
            key={key(target)}
            target={target}
            draft={draftOf(target)}
            onChange={(change) => update(target, change)}
          />
        ))}
        {submit.error ? (
          <Text tone="secondary" accessibilityLiveRegion="polite">
            {`Couldn't send your review: ${submit.error.message}`}
          </Text>
        ) : null}
        <Button
          label={rated.length > 1 ? `Send ${rated.length} reviews` : 'Send review'}
          disabled={!rated.length}
          loading={submit.isPending}
          onPress={() => submit.mutate({ orderId: order.id, drafts: rated }, { onSuccess: () => router.back() })}
        />
      </ScrollView>
    </>
  );
}

function TargetReview({
  target,
  draft,
  onChange,
}: Readonly<{ target: ReviewTarget; draft: Draft; onChange: (change: Partial<Draft>) => void }>) {
  const theme = useTheme();
  const heading = target.reference === 'seller' ? `The shop: ${target.title}` : target.title;
  return (
    <View style={{ gap: theme.space.sm }}>
      <Text variant="heading">{heading}</Text>
      <StarInput value={draft.rating} onChange={(rating) => onChange({ rating })} label={`Rate ${target.title}`} />
      {draft.rating ? (
        <TextInput
          value={draft.note}
          onChangeText={(note) => onChange({ note })}
          placeholder="What stood out? (optional)"
          placeholderTextColor={theme.colors.textSecondary}
          accessibilityLabel={`Your review of ${target.title} (optional)`}
          maxLength={NOTE_LIMIT}
          multiline
          style={[
            styles.note,
            theme.type.body,
            {
              minHeight: theme.touchTarget * 2,
              borderRadius: theme.radius.md,
              borderColor: theme.colors.divider,
              padding: theme.space.md,
              color: theme.colors.ink,
              fontFamily: theme.fontFamily,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { borderWidth: 1, textAlignVertical: 'top' },
});
