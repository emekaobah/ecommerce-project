import { useAuth } from '@clerk/expo';
import { reviewCounts, reviewStatus } from '@oja/domain';
import {
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  InlineNote,
  PressableSurface,
  Sheet,
  Skeleton,
  StatusChip,
  Text,
  TextField,
  useTheme,
  useToast,
} from '@oja/ui';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { useDeleteReview, useEditReview, useMyReviews, type MyReview } from '@/api/reviews';
import { reviewDate, ReviewSubjectLine, ShopReply, Stars, StarInput } from '@/components/reviews';
import { SheetModal } from '@/components/sheet-modal';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';

type Filter = 'all' | 'shops' | 'products';

/** Mercur keeps a review's note to 300 characters. */
const NOTE_LIMIT = 300;

/** What a review is of, as its card names it. */
function subjectOf(review: MyReview) {
  return review.reference === 'seller'
    ? { title: review.seller?.name ?? 'Shop', detail: 'Shop', shop: { name: review.seller?.name ?? 'Shop', logo: review.seller?.logo } }
    : { title: review.product?.title ?? 'Product', detail: 'Product', thumbnail: review.product?.thumbnail ?? null };
}

/**
 * Every review the buyer has written (#81), of shops and products, newest first, each with its
 * moderation state; a published one shows the shop's reply. The ··· menu edits a review, which
 * sends it back to moderation, or deletes it.
 */
export function MyReviewsScreen() {
  const theme = useTheme();
  const toast = useToast();
  const { userId } = useAuth();
  const reviews = useMyReviews(userId);
  const [filter, setFilter] = useState<Filter>('all');
  const [menuFor, setMenuFor] = useState<MyReview | null>(null);
  const [editing, setEditing] = useState<MyReview | null>(null);
  const [deleting, setDeleting] = useState<MyReview | null>(null);
  const { refreshing, refresh } = usePullToRefresh(async () => {
    const result = await reviews.refetch();
    if (result.isError) toast({ message: "Couldn't refresh your reviews", tone: 'problem' });
  });

  if (reviews.error && !reviews.data) {
    return (
      <ErrorState
        title="Couldn't load your reviews"
        body="Your reviews are safe. Check your connection and try again."
        error={reviews.error}
        onRetry={() => void reviews.refetch()}
      />
    );
  }
  if (!reviews.data) return <MyReviewsSkeleton />;
  if (!reviews.data.length) {
    return (
      <EmptyState icon="star" title="No reviews yet" body="After an order arrives, you can review the shop and what you bought." />
    );
  }

  const counts = reviewCounts(reviews.data);
  const shown = reviews.data.filter(
    (review) => filter === 'all' || (filter === 'shops' ? review.reference === 'seller' : review.reference === 'product'),
  );
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      <FlatList
        data={shown}
        keyExtractor={(review) => review.id}
        contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[12] }}
        refreshing={refreshing}
        onRefresh={refresh}
        ListHeaderComponent={
          <Segments
            selected={filter}
            onSelect={setFilter}
            options={[
              { id: 'all', label: 'All', count: counts.all },
              { id: 'shops', label: 'Shops', count: counts.shops },
              { id: 'products', label: 'Products', count: counts.products },
            ]}
          />
        }
        ListEmptyComponent={
          <Text tone="muted" style={{ paddingVertical: theme.space[6] }}>
            {filter === 'shops' ? "You haven't reviewed a shop yet." : "You haven't reviewed a product yet."}
          </Text>
        }
        ItemSeparatorComponent={() => <View style={{ height: theme.line.divider, backgroundColor: theme.colors.line }} />}
        renderItem={({ item }) => <ReviewCard review={item} onMenu={() => setMenuFor(item)} />}
      />

      <SheetModal visible={!!menuFor} onClose={() => setMenuFor(null)}>
        {menuFor ? (
          <Sheet
            title={subjectOf(menuFor).title}
            actions={
              <>
                <Button
                  label="Edit review"
                  variant="secondary"
                  icon="edit"
                  onPress={() => {
                    setEditing(menuFor);
                    setMenuFor(null);
                  }}
                />
                <Button
                  label="Delete review"
                  variant="danger"
                  onPress={() => {
                    setDeleting(menuFor);
                    setMenuFor(null);
                  }}
                />
                <Button label="Cancel" variant="link" onPress={() => setMenuFor(null)} />
              </>
            }
          />
        ) : null}
      </SheetModal>

      <EditReviewModal review={editing} onClose={() => setEditing(null)} />
      <DeleteReviewModal review={deleting} onClose={() => setDeleting(null)} />
    </View>
  );
}

/** All, Shops and Products with their counts; the selected one indigo. */
function Segments({
  options,
  selected,
  onSelect,
}: Readonly<{ options: { id: Filter; label: string; count: number }[]; selected: Filter; onSelect: (id: Filter) => void }>) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.row, styles.wrap, { gap: theme.space[2], paddingTop: theme.space[2], paddingBottom: theme.space[2] }]}>
      {options.map((option) => {
        const on = option.id === selected;
        return (
          <PressableSurface
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${option.label}, ${option.count}`}
            onPress={() => onSelect(option.id)}
            style={[
              styles.segment,
              {
                minHeight: theme.hitArea,
                paddingHorizontal: theme.space[3],
                borderRadius: theme.radius.pill,
                backgroundColor: on ? theme.colors.selected : theme.colors.tile,
              },
            ]}>
            <Text variant="meta" weight="bold" style={{ color: on ? theme.colors.onPrimary : theme.colors.ink }}>
              {`${option.label} ${option.count}`}
            </Text>
          </PressableSurface>
        );
      })}
    </View>
  );
}

function ReviewCard({ review, onMenu }: Readonly<{ review: MyReview; onMenu: () => void }>) {
  const theme = useTheme();
  const subject = subjectOf(review);
  const status = reviewStatus(review.status);
  return (
    <View style={{ gap: theme.space[2], paddingVertical: theme.space[4] }}>
      <ReviewSubjectLine
        {...subject}
        trailing={
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={`Edit or delete your review of ${subject.title}`}
            onPress={onMenu}
            style={[styles.centre, { minWidth: theme.hitArea, minHeight: theme.hitArea, borderRadius: theme.radius.md }]}>
            <Text weight="extrabold" tone="muted" style={{ letterSpacing: 2 }}>
              ···
            </Text>
          </PressableSurface>
        }
      />
      <View style={[styles.row, styles.between, styles.wrap, { gap: theme.space[2] }]}>
        <Stars rating={review.rating} />
        <StatusChip label={status.label} tone={status.tone} icon={status.icon} />
      </View>
      {review.customer_note ? <Text>{review.customer_note}</Text> : null}
      {review.status === 'rejected' && status.note ? (
        <Text variant="meta" tone="muted">
          {status.note}
        </Text>
      ) : null}
      {review.status === 'published' && review.seller_note ? (
        <ShopReply note={review.seller_note} shop={review.reference === 'seller' ? subject.title : undefined} />
      ) : null}
      <Text variant="meta" tone="muted">
        {reviewDate(review.created_at)}
      </Text>
    </View>
  );
}

/** Edits the stars and words of one review in a sheet; saving sends it back to moderation. */
function EditReviewModal({ review, onClose }: Readonly<{ review: MyReview | null; onClose: () => void }>) {
  return (
    <SheetModal visible={!!review} onClose={onClose}>
      {review ? <EditReview key={review.id} review={review} onClose={onClose} /> : null}
    </SheetModal>
  );
}

function EditReview({ review, onClose }: Readonly<{ review: MyReview; onClose: () => void }>) {
  const toast = useToast();
  const edit = useEditReview();
  const [rating, setRating] = useState(review.rating);
  const [note, setNote] = useState(review.customer_note ?? '');
  const title = subjectOf(review).title;
  const unchanged = rating === review.rating && note.trim() === (review.customer_note ?? '');

  return (
    <Sheet
      title="Edit your review"
      message="Oja's team checks it again before other buyers see it."
      actions={
        <>
          {edit.error ? <InlineNote>{"Your changes didn't save. They're still here, so try again."}</InlineNote> : null}
          <Button
            label="Save changes"
            size="main"
            disabled={unchanged}
            loading={edit.isPending}
            onPress={() =>
              edit.mutate(
                { id: review.id, rating, customer_note: note.trim() || null },
                {
                  onSuccess: () => {
                    onClose();
                    toast({ message: 'Review sent to be checked', tone: 'done' });
                  },
                },
              )
            }
          />
          <Button label="Cancel" variant="secondary" onPress={onClose} disabled={edit.isPending} />
        </>
      }>
      <StarInput value={rating} onChange={setRating} label={`Rate ${title}`} />
      <TextField
        label={`Your review of ${title}`}
        optional
        value={note}
        onChangeText={setNote}
        placeholder="What stood out?"
        maxLength={NOTE_LIMIT}
        multiline
      />
    </Sheet>
  );
}

/** Asks before deleting a review, naming what it's of. */
function DeleteReviewModal({ review, onClose }: Readonly<{ review: MyReview | null; onClose: () => void }>) {
  const toast = useToast();
  const remove = useDeleteReview();
  return (
    <SheetModal visible={!!review} onClose={onClose} dismissible={!remove.isPending}>
      {review ? (
        <ConfirmSheet
          title="Delete this review?"
          message={`Your review of ${subjectOf(review).title} is removed for good.`}
          confirmLabel="Delete"
          destructive
          loading={remove.isPending}
          onCancel={onClose}
          onConfirm={() =>
            remove.mutate(review.id, {
              onSuccess: () => {
                onClose();
                toast({ message: 'Review deleted', tone: 'done' });
              },
              onError: () => toast({ message: "Couldn't delete your review. Try again.", tone: 'problem' }),
            })
          }
        />
      ) : null}
    </SheetModal>
  );
}

function MyReviewsSkeleton() {
  const theme = useTheme();
  const thumb = theme.shopMark.sm.size;
  return (
    <View
      accessible
      accessibilityLabel="Loading your reviews"
      style={[styles.fill, { backgroundColor: theme.colors.bg, paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }]}>
      <View style={[styles.row, { gap: theme.space[2], paddingBottom: theme.space[2] }]}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width={theme.space[12] * 1.5} height={theme.hitArea} radius="pill" />
        ))}
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ gap: theme.space[2], paddingVertical: theme.space[4] }}>
          <View style={[styles.row, { gap: theme.space[2] }]}>
            <Skeleton width={thumb} height={thumb} radius="md" />
            <View style={[styles.fill, { gap: theme.space[1] }]}>
              <Skeleton width="50%" height={theme.type.meta.lineHeight} />
              <Skeleton width="30%" height={theme.type.meta.lineHeight} />
            </View>
          </View>
          <Skeleton width="85%" height={theme.type.body.lineHeight} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  between: { justifyContent: 'space-between' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  segment: { justifyContent: 'center' },
});
