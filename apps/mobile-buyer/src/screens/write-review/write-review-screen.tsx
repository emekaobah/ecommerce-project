import { useAuth } from '@clerk/expo';
import { reviewAction, reviewForm, type ReviewFormEntry, type ReviewSubject } from '@oja/domain';
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
const key = (s: ReviewSubject) => `${s.reference}:${s.reference_id}`;
const draftFrom = (entry: ReviewFormEntry): Draft => ({
  rating: entry.review?.rating ?? 0,
  note: entry.review?.customer_note ?? '',
});

/**
 * Reviewing a received shop's order (#7): the shop and each product on it, each rated from one
 * to five with an optional note. A buyer has one review of each shop and product: one they
 * already wrote, on this order or an earlier one, is filled in to edit. Only what the buyer rated
 * or changed is sent, and each waits for moderation.
 */
export function WriteReviewScreen({ groupId, orderId }: Readonly<{ groupId: string; orderId: string }>) {
  const { userId } = useAuth();
  const group = useOrderGroup(userId, groupId);

  if (group.error && !group.data) {
    return <ErrorState title="Couldn't load this order" message={group.error.message} onRetry={() => void group.refetch()} />;
  }
  if (!group.data) return <LoadingState />;
  const order = group.data.orders.find((o) => o.id === orderId);
  if (!order || !reviewAction(order)) {
    return (
      <EmptyState
        title="Not ready for review"
        message="You can review an order once you have received it."
        action={{ label: 'Back to the order', onPress: () => router.back() }}
      />
    );
  }
  return <ReviewForm order={order} entries={reviewForm(order)} />;
}

function ReviewForm({ order, entries }: Readonly<{ order: SellerOrder; entries: ReviewFormEntry[] }>) {
  const theme = useTheme();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(entries.map((entry) => [key(entry), draftFrom(entry)])),
  );
  const submit = useSubmitReviews();
  const update = (entry: ReviewFormEntry, change: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [key(entry)]: { ...current[key(entry)]!, ...change } }));

  // New reviews the buyer rated, and their reviews they changed.
  const toSend: ReviewDraft[] = entries.flatMap((entry) => {
    const { rating, note } = drafts[key(entry)]!;
    const unchanged = rating === draftFrom(entry).rating && note === draftFrom(entry).note;
    if (!rating || unchanged) return [];
    return [
      {
        reference: entry.reference,
        reference_id: entry.reference_id,
        reviewId: entry.review?.id ?? null,
        rating,
        customer_note: note.trim() || null,
      },
    ];
  });
  const editing = entries.every((entry) => entry.review);

  return (
    <>
      <Stack.Screen options={{ title: editing ? 'Edit your review' : `Review ${order.seller.name}` }} />
      <ScrollView
        style={{ backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg, paddingBottom: theme.space.xxl }}
        keyboardShouldPersistTaps="handled">
        <Text tone="secondary">
          {
            "You review each shop and product once, and can edit it after a later order. We check every review, and every edit, before other buyers see it."
          }
        </Text>
        {entries.map((entry) => (
          <EntryReview
            key={key(entry)}
            entry={entry}
            draft={drafts[key(entry)]!}
            onChange={(change) => update(entry, change)}
          />
        ))}
        {submit.error ? (
          <Text tone="secondary" accessibilityLiveRegion="polite">
            {`Couldn't send your review: ${submit.error.message}`}
          </Text>
        ) : null}
        <Button
          label={editing ? 'Save changes' : 'Send review'}
          disabled={!toSend.length}
          loading={submit.isPending}
          onPress={() => submit.mutate({ orderId: order.id, drafts: toSend }, { onSuccess: () => router.back() })}
        />
      </ScrollView>
    </>
  );
}

function EntryReview({
  entry,
  draft,
  onChange,
}: Readonly<{ entry: ReviewFormEntry; draft: Draft; onChange: (change: Partial<Draft>) => void }>) {
  const theme = useTheme();
  const heading = entry.reference === 'seller' ? `The shop: ${entry.title}` : entry.title;
  return (
    <View style={{ gap: theme.space.sm }}>
      <Text variant="heading">{heading}</Text>
      {entry.review ? (
        <Text variant="caption" tone="secondary">
          Your review: change it here.
        </Text>
      ) : null}
      <StarInput value={draft.rating} onChange={(rating) => onChange({ rating })} label={`Rate ${entry.title}`} />
      {draft.rating ? (
        <TextInput
          value={draft.note}
          onChangeText={(note) => onChange({ note })}
          placeholder="What stood out? (optional)"
          placeholderTextColor={theme.colors.textSecondary}
          accessibilityLabel={`Your review of ${entry.title} (optional)`}
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
