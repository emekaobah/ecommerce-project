import { useAuth } from '@clerk/expo';
import { reviewAction, reviewerName, reviewForm, type ReviewFormEntry, type ReviewSubject } from '@oja/domain';
import { EmptyState, ErrorState, InlineNote, Skeleton, StickyAction, Text, TextField, useTheme } from '@oja/ui';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { useCustomer } from '@/api/customer';
import { useOrderGroup, type SellerOrder } from '@/api/orders';
import { useSubmitReviews, type ReviewDraft } from '@/api/reviews';
import { ReviewSubjectLine, StarInput } from '@/components/reviews';

/** Mercur keeps a review's note to 300 characters. */
const NOTE_LIMIT = 300;

/** What each star means, said under the stars as the buyer picks. */
const RATING_WORDS = ['', 'Poor', 'Fair', 'Okay', 'Good', 'Great'] as const;

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
    return (
      <ErrorState
        title="Couldn't load this order"
        body="Check your connection and try again."
        error={group.error}
        onRetry={() => void group.refetch()}
      />
    );
  }
  if (!group.data) return <ReviewFormSkeleton />;
  const order = group.data.orders.find((o) => o.id === orderId);
  if (!order || !reviewAction(order)) {
    return (
      <EmptyState
        icon="star"
        title="Not ready for review"
        body="You can review an order once you have received it."
        action={{ label: 'Back to the order', onPress: () => router.back() }}
      />
    );
  }
  return <ReviewForm order={order} entries={reviewForm(order)} />;
}

function ReviewForm({ order, entries }: Readonly<{ order: SellerOrder; entries: ReviewFormEntry[] }>) {
  const theme = useTheme();
  const { userId } = useAuth();
  const customer = useCustomer(userId);
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
  const shownAs = customer.data
    ? `Shown as ${reviewerName(customer.data)}, once Oja's team has checked it.`
    : "Shown once Oja's team has checked it.";
  const thumbnails = new Map(order.items.map((item) => [item.product_id, item.thumbnail]));

  return (
    <KeyboardAvoidingView style={[styles.fill, { backgroundColor: theme.colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: editing ? 'Edit your review' : 'Review' }} />
      <ScrollView
        contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6], paddingBottom: theme.space[8] }}
        keyboardShouldPersistTaps="handled">
        {entries.map((entry) => (
          <EntryReview
            key={key(entry)}
            entry={entry}
            shop={order.seller}
            thumbnail={thumbnails.get(entry.reference_id) ?? null}
            draft={drafts[key(entry)]!}
            hint={shownAs}
            onChange={(change) => update(entry, change)}
          />
        ))}
      </ScrollView>
      {submit.error ? (
        <View style={{ paddingHorizontal: theme.space[4] }}>
          <InlineNote>{"Your review didn't all send. What you wrote is still here, so try again."}</InlineNote>
        </View>
      ) : null}
      <StickyAction
        label={editing ? 'Save changes' : 'Post review'}
        disabled={!toSend.length}
        loading={submit.isPending}
        onPress={() => submit.mutate({ orderId: order.id, drafts: toSend }, { onSuccess: () => router.back() })}
      />
    </KeyboardAvoidingView>
  );
}

function EntryReview({
  entry,
  shop,
  thumbnail,
  draft,
  hint,
  onChange,
}: Readonly<{
  entry: ReviewFormEntry;
  shop: { name: string; logo?: string | null };
  thumbnail: string | null;
  draft: Draft;
  hint: string;
  onChange: (change: Partial<Draft>) => void;
}>) {
  const theme = useTheme();
  const isShop = entry.reference === 'seller';
  return (
    <View style={{ gap: theme.space[2] }}>
      <ReviewSubjectLine
        title={entry.title}
        detail={isShop ? 'Shop' : shop.name}
        thumbnail={thumbnail}
        shop={isShop ? shop : undefined}
      />
      {entry.review ? (
        <Text variant="meta" tone="muted">
          {"Your review: change it here. It goes back to Oja's team to check."}
        </Text>
      ) : null}
      <StarInput value={draft.rating} onChange={(rating) => onChange({ rating })} label={`Rate ${entry.title}`} />
      <Text variant="meta" weight="bold" tone="muted" style={styles.centred} accessibilityLiveRegion="polite">
        {RATING_WORDS[draft.rating] || ' '}
      </Text>
      {draft.rating ? (
        <TextField
          label={`Your review of ${entry.title}`}
          optional
          hint={hint}
          value={draft.note}
          onChangeText={(note) => onChange({ note })}
          placeholder="What stood out?"
          maxLength={NOTE_LIMIT}
          multiline
        />
      ) : null}
    </View>
  );
}

function ReviewFormSkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.bg, padding: theme.space[4], gap: theme.space[3] }]}>
      <Skeleton width="60%" height={theme.type.meta.lineHeight * 2} />
      <Skeleton width="70%" height={theme.hitArea} style={styles.centredBlock} />
      <Skeleton height={theme.block.textArea} radius="md" />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centred: { textAlign: 'center' },
  centredBlock: { alignSelf: 'center' },
});
