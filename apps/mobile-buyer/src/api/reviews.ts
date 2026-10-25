import type { ReviewKind, ReviewSubject } from '@oja/domain';
import { skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { storeClient } from './client';
import { summaryKeys } from './customer';
import { orderKeys } from './orders';

export const reviewKeys = {
  all: ['reviews'] as const,
  preview: (kind: ReviewKind, id: string) => [...reviewKeys.all, 'preview', { kind, id }] as const,
  pages: (kind: ReviewKind, id: string) => [...reviewKeys.all, 'pages', { kind, id }] as const,
  /** Keyed by Clerk user so one buyer never sees another's reviews. */
  mine: (userId: string) => [...reviewKeys.all, 'mine', { userId }] as const,
};

/** How many reviews a product or shop page shows before "See all". */
export const REVIEW_PREVIEW_COUNT = 3;
const PAGE_SIZE = 20;

function fetchPublishedReviews(kind: ReviewKind, id: string, page: { limit: number; offset: number }) {
  return kind === 'seller'
    ? storeClient.store.sellers.$id.reviews.query({ $id: id, ...page })
    : storeClient.store.products.$id.reviews.query({ $id: id, ...page });
}

/** A page of a shop's or product's published reviews, with the average and count of them all. */
export type PublishedReviews = Awaited<ReturnType<typeof fetchPublishedReviews>>;
export type PublishedReview = PublishedReviews['reviews'][number];

/** A shop's or product's rating and its newest few published reviews, for its page. */
export function useReviewPreview(kind: ReviewKind, id: string) {
  return useQuery({
    queryKey: reviewKeys.preview(kind, id),
    queryFn: () => fetchPublishedReviews(kind, id, { limit: REVIEW_PREVIEW_COUNT, offset: 0 }),
  });
}

/** Every published review of a shop or product, newest first, a page at a time. */
export function useReviewPages(kind: ReviewKind, id: string) {
  return useInfiniteQuery({
    queryKey: reviewKeys.pages(kind, id),
    queryFn: ({ pageParam }) => fetchPublishedReviews(kind, id, { limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.reviews.length;
      return next < last.count ? next : undefined;
    },
  });
}

/**
 * One review the buyer writes of a shop or product on their order, or an edit of the one they
 * already wrote of it (`reviewId`), on this order or an earlier one.
 */
export type ReviewDraft = ReviewSubject & { reviewId: string | null; rating: number; customer_note: string | null };

function sendReview(orderId: string, { reviewId, rating, customer_note, ...subject }: ReviewDraft) {
  return reviewId
    ? storeClient.store.reviews.$id.mutate({ $id: reviewId, rating, customer_note })
    : storeClient.store.reviews.mutate({ order_id: orderId, ...subject, rating, customer_note });
}

/**
 * Submits the buyer's new and edited reviews of a received order. Each waits for moderation,
 * an edit again, which the order then shows. Each is sent on its own, so when some fail the
 * error says the others were saved; the order shows which.
 */
export function useSubmitReviews() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, drafts }: { orderId: string; drafts: ReviewDraft[] }) => {
      const sent = await Promise.allSettled(drafts.map((draft) => sendReview(orderId, draft)));
      const failed = sent.flatMap((result) => (result.status === 'rejected' ? [result.reason as Error] : []));
      if (!failed.length) return;
      const saved = drafts.length - failed.length;
      throw new Error(
        saved ? `${saved} of ${drafts.length} reviews were sent; the rest weren't: ${failed[0]!.message}` : failed[0]!.message,
      );
    },
    onSettled: () => refetchAfterReviewChange(queryClient),
  });
}

/** What a change to the buyer's reviews shows on: their orders, My reviews and the Account counts. */
function refetchAfterReviewChange(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: orderKeys.all }),
    queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
    queryClient.invalidateQueries({ queryKey: summaryKeys.all }),
  ]);
}

/**
 * What each of the buyer's reviews is of, read through Mercur's links of a review to its shop or
 * product, and the shop it was bought from (#96), which replies to it.
 */
const MY_REVIEW_FIELDS = '+product.title,+product.thumbnail,+seller.name,+seller.logo,+shop.name';
/** Mercur's most per request; a buyer writes one review per shop and product, so this is rarely more than one. */
const MY_REVIEWS_PAGE = 50;

async function fetchMyReviews() {
  const page = (offset: number) =>
    storeClient.store.reviews.query({ limit: MY_REVIEWS_PAGE, offset, order: '-created_at', fields: MY_REVIEW_FIELDS });
  const first = await page(0);
  const reviews = [...first.reviews];
  while (reviews.length < first.count) {
    const next = await page(reviews.length);
    if (!next.reviews.length) break;
    reviews.push(...next.reviews);
  }
  return reviews;
}

/** One review the buyer wrote, with what it's of. */
export type MyReview = Awaited<ReturnType<typeof fetchMyReviews>>[number];

/**
 * Every review the signed-in buyer wrote, of shops and products, newest first, whatever its
 * moderation. All of them at once, so My reviews' filter counts are true.
 */
export function useMyReviews(userId: string | null | undefined) {
  return useQuery({
    queryKey: reviewKeys.mine(userId ?? ''),
    queryFn: userId ? fetchMyReviews : skipToken,
  });
}

/** Edits one of the buyer's reviews; it goes back to moderation. */
export function useEditReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rating, customer_note }: { id: string; rating: number; customer_note: string | null }) =>
      storeClient.store.reviews.$id.mutate({ $id: id, rating, customer_note }),
    onSettled: () => refetchAfterReviewChange(queryClient),
  });
}

/** Deletes one of the buyer's reviews. */
export function useDeleteReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storeClient.store.reviews.$id.delete({ $id: id }),
    onSettled: () => refetchAfterReviewChange(queryClient),
  });
}
